using System.Numerics;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using YetAnotherCat.Accounting;

namespace YetAnotherCat.Infrastructure;

public sealed class CycleService(AccountingDb db, SettlementBridge bridge, ILogger<CycleService> logger, CycleVerification verification)
{
    public static bool IsStake(ChainEvent e) => e.EventType is "positionCreated" or "deposited" or "withdrawRequested" or "withdrawExecuted";
    public static WalletPoints[] Calculate(IEnumerable<ChainEvent> events, long start, long end) => events.Where(IsStake).GroupBy(e => e.Wallet).Select(g => new WalletPoints(g.Key,
        Points.CalculatePoints(g.Select(e => new Transition(e.BlockTime, Points.Integer(e.EffectiveLockedAmount), e.Slot, e.TransactionIndex, e.EventIndex)), start, end).ToString())).Where(p => p.PointUnits != "0").ToArray();
    public async Task<SettlementChainState> State(CancellationToken ct = default) => (await bridge.Call("state", ct: ct)).Deserialize<SettlementChainState>(HistoryReader.Json)!;
    public async Task<CycleRecord> Build(ulong id, SettlementChainState state, CancellationToken ct = default, bool persist = true)
    {
        var bounds = Settlement.Bounds(long.Parse(state.Config.Genesis), long.Parse(state.Config.Duration), id);
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var cp = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(ct) ?? throw new InvalidOperationException("Accounting not initialized");
        if (cp.ProgramId != state.ProgramId || cp.GenesisHash != state.GenesisHash || cp.Mint != state.Config.TokenMint || cp.ThroughTime < checked(bounds.End + 5)) throw new InvalidOperationException("Wrong chain or finalized accounting watermark insufficient");
        var events = await db.Events.AsNoTracking().OrderBy(e => e.Slot).ThenBy(e => e.TransactionIndex).ThenBy(e => e.EventIndex).ToListAsync(ct);
        var result = Settlement.BuildCycleSettlement(new(state.ProgramId, cp.Mint, cp.GenesisHash, id.ToString(), bounds.Start, bounds.End), Calculate(events, bounds.Start, bounds.End), Points.Integer(state.Config.Emission));
        // Independent TypeScript implementation recomputes allocation, ordering and hashes.
        var verified = await bridge.Call("verify", result.Manifest, ct: ct);
        if (verified.GetProperty("manifestHash").GetString() != result.ManifestHash) throw new InvalidOperationException("Independent verifier mismatch");
        var record = await db.Cycles.SingleOrDefaultAsync(c => c.CycleId == id.ToString(), ct);
        if (record != null)
        {
            if (record.ManifestJson != result.Canonical || record.ManifestHash != result.ManifestHash || record.Root != result.Manifest.MerkleRoot) throw new InvalidOperationException("CRITICAL: regenerated cycle differs from frozen result");
        }
        else
        {
            if (!persist) throw new InvalidOperationException("Cycle has not been calculated");
            record = new CycleRecord { CycleId = id.ToString(), StartTime = bounds.Start, EndTime = bounds.End, ManifestJson = result.Canonical, ManifestHash = result.ManifestHash, Root = result.Manifest.MerkleRoot, ProofsJson = JsonSerializer.Serialize(result.Proofs, HistoryReader.Json), InputThroughSlot = cp.ThroughSlot, InputHash = Settlement.Hash(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(events, HistoryReader.Json))) };
            db.Cycles.Add(record);
        }
        if (!persist) return record;
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        logger.LogInformation("Cycle {Cycle} calculated: {Miners} miners, {Points} point units, root {Root}, manifest {Hash}", id, result.Manifest.Miners.Length, result.Manifest.TotalPointUnits, record.Root, record.ManifestHash);
        return record;
    }
    public static CycleManifest Manifest(CycleRecord c) => JsonSerializer.Deserialize<CycleManifest>(c.ManifestJson, HistoryReader.Json)!;
    public static void CheckPublished(CycleRecord record, JsonElement chain)
    {
        string Bytes(string name) => Convert.ToHexStringLower(chain.GetProperty(name).EnumerateArray().Select(x => x.GetByte()).ToArray());
        var m = Manifest(record);
        if (chain.GetProperty("cycleId").GetString() != m.CycleId || Bytes("root") != record.Root || Bytes("manifestHash") != record.ManifestHash || Bytes("totalPoints") != Convert.ToHexStringLower(Settlement.Unsigned(Points.Integer(m.TotalPointUnits), 32, true)) || chain.GetProperty("start").GetString() != m.StartTime || chain.GetProperty("end").GetString() != m.EndTime || chain.GetProperty("budget").GetString() != m.RewardBudgetBaseUnits || chain.GetProperty("totalAllocated").GetString() != m.TotalAllocatedBaseUnits || chain.GetProperty("leafCount").GetInt32() != m.LeafCount) throw new InvalidOperationException("CRITICAL: immutable on-chain cycle mismatch");
    }
    public async Task Reconcile(SettlementChainState state, CancellationToken ct = default)
    {
        foreach (var chain in state.Cycles)
        {
            var id = chain.GetProperty("cycleId").GetString()!;
            var record = await db.Cycles.SingleOrDefaultAsync(c => c.CycleId == id, ct) ?? await Build(ulong.Parse(id), state, ct);
            CheckPublished(record, chain); record.Status = "PUBLISHED"; record.Address = chain.GetProperty("address").GetString()!;
            var source = await db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.EventType == "cyclePublished" && e.CycleId == id, ct);
            if (source != null) { record.PublicationSignature = source.Signature; record.PublishedSlot = source.Slot; }
        }
        if (await db.Cycles.AnyAsync(c => c.Status == "PUBLISHED" && !state.Cycles.Select(x => x.GetProperty("cycleId").GetString()).Contains(c.CycleId), ct)) throw new InvalidOperationException("Published DB cycle missing on chain");
        await db.SaveChangesAsync(ct);
    }
    public async Task<CycleRecord> Publish(ulong id, SettlementChainState state, string publisherFile, CancellationToken ct = default)
    {
        if (id != ulong.Parse(state.Config.NextCycle)) throw new InvalidOperationException("Publish only the next sequential cycle; reconcile chain first");
        await RequirePreviousVerified(id, ct);
        var timing=Stopwatch.StartNew();
        var record = await Build(id, state, ct);
        var buildMs=timing.Elapsed.TotalMilliseconds;timing.Restart();
        var checkedReport = await verification.Verify(record, beforePublication: true, ct: ct, component:"publisher-verify-pre");
        var verifyPreMs=timing.Elapsed.TotalMilliseconds;timing.Restart();
        if (checkedReport.GetProperty("result").GetString() != "VALID") throw new InvalidOperationException("Independent chain verification did not pass; publication refused");
        await verification.Persist(record, ct);
        var manifestStorageMs=timing.Elapsed.TotalMilliseconds;timing.Restart();
        var result = await bridge.Call("publish", Manifest(record), publisherFile, ct);
        var publicationFinalizationMs=timing.Elapsed.TotalMilliseconds;timing.Restart();
        CheckPublished(record, result.GetProperty("cycle"));
        record.Status = "PUBLISHED";
        if (result.TryGetProperty("signature", out var sig)) record.PublicationSignature = sig.GetString()!;
        await db.SaveChangesAsync(ct);
        var post = await verification.Verify(record, ct: ct, component:"publisher-verify-post");
        RecoveryPolicy.RequireValid(post.GetProperty("result").GetString());
        Console.WriteLine("YAC_CYCLE_RECOVERY "+JsonSerializer.Serialize(new {cycleId=id.ToString(),buildMs,verifyPreMs,manifestStorageMs,publicationFinalizationMs,verifyPostMs=timing.Elapsed.TotalMilliseconds,signature=record.PublicationSignature,result="VALID"},HistoryReader.Json));
        db.OperatorEvents.Add(new() { Kind="cycle_published", CycleId=record.CycleId, Message=record.PublicationSignature });
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Cycle {Cycle} publication finalized: {Signature}", id, record.PublicationSignature);
        return record;
    }
    public async Task RequirePreviousVerified(ulong next, CancellationToken ct = default)
    {
        if (next == 0) return;
        var prior = await db.Cycles.SingleAsync(c => c.CycleId == (next-1).ToString(), ct);
        var report = await db.Verifications.AsNoTracking().SingleOrDefaultAsync(v => v.CycleId == prior.CycleId, ct);
        if (report?.Status == "INVALID") throw new InvalidOperationException("Previous publication INVALID; operator investigation required");
        if (report?.Status != "VALID" || report.ManifestHash != prior.ManifestHash || report.Root != prior.Root)
            RecoveryPolicy.RequireValid((await verification.Verify(prior,ct:ct,component:"recovery-post-reconcile")).GetProperty("result").GetString());
    }
    public async Task<object> Detail(CycleRecord record, CancellationToken ct = default) => new { cycleId = record.CycleId, startTime = record.StartTime.ToString(), endTime = record.EndTime.ToString(), record.Status, manifest = Manifest(record), record.ManifestHash, record.PublicationSignature, record.PublishedSlot, record.Address, claimedWallets = await db.Events.AsNoTracking().Where(e => e.CycleId == record.CycleId && e.EventType == "cycleClaimed").Select(e => e.Wallet).ToArrayAsync(ct) };
}
