using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace YetAnotherCat.Infrastructure;

public sealed class EventStore(AccountingDb db, ILogger<EventStore> logger)
{
    private static IOrderedEnumerable<ChainEvent> Ordered(IEnumerable<ChainEvent> events) => events.OrderBy(e => e.Slot).ThenBy(e => e.TransactionIndex).ThenBy(e => e.EventIndex);
    public async Task<int> Ingest(HistoryBatch batch, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockWriter(ct);
        var cp = await db.Checkpoints.SingleOrDefaultAsync(ct);
        if (cp != null && (cp.ProgramId != batch.ProgramId || cp.Mint != batch.Mint || cp.GenesisHash != batch.GenesisHash || cp.StartSlot != batch.StartSlot || batch.ThroughSlot < cp.ThroughSlot))
            throw new InvalidOperationException("Chain identity/checkpoint mismatch; refusing mixed histories");
        if (batch.StartSlot < 1 || batch.ThroughSlot < batch.StartSlot || batch.ThroughTime < 0) throw new InvalidOperationException("Invalid finalized boundary");
        var added = 0;
        foreach (var e in Ordered(batch.Events))
        {
            if (e.Slot < batch.StartSlot || e.Slot > batch.ThroughSlot || e.Id != $"{e.Signature}:{e.EventIndex}" || e.TransactionIndex < 0 || e.EventIndex < 0)
                throw new InvalidOperationException("Event outside accepted finalized range");
            var existing = await db.Events.FindAsync([e.Id], ct);
            if (existing != null)
            {
                if (JsonSerializer.Serialize(existing) != JsonSerializer.Serialize(e)) throw new InvalidOperationException("Conflicting duplicate event");
                continue;
            }
            if (cp != null && e.Slot <= cp.ThroughSlot) throw new InvalidOperationException("Previously missed event behind checkpoint; rebuild source in a fresh DB");
            db.Events.Add(e);
            if(e.EventType=="cycleClaimed")db.OperatorEvents.Add(new(){Kind="claim_observed",CycleId=e.CycleId,Message=e.Signature});
            await Fold(e, ct);
            added++;
        }
        cp ??= new IndexerCheckpoint { ProgramId = batch.ProgramId, GenesisHash = batch.GenesisHash, Mint = batch.Mint, StartSlot = batch.StartSlot };
        if (db.Entry(cp).State == EntityState.Detached) db.Checkpoints.Add(cp);
        cp.ThroughSlot = batch.ThroughSlot;
        // Chain timestamp regressions never create negative elapsed time.
        if (batch.ThroughTime < cp.ThroughTime) logger.LogWarning("Finalized clock regressed {Time} below {Previous}", batch.ThroughTime, cp.ThroughTime);
        cp.ThroughTime = Math.Max(cp.ThroughTime, Math.Max(batch.ThroughTime, batch.Events.Select(e => e.BlockTime).DefaultIfEmpty(0).Max()));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        if (added > 0) logger.LogInformation("Ingested {Events} events, projections/checkpoint finalized through slot {Slot}", added, cp.ThroughSlot);
        return added;
    }
    private async Task Fold(ChainEvent e, CancellationToken ct)
    {
        if (e.EventType is "faucetClaimed" or "cyclePublished" or "cycleClaimed") return;
        var p = await db.Projections.FindAsync([e.Wallet], ct);
        if (p == null)
        {
            if (e.EventType != "positionCreated") throw new InvalidOperationException("Missing position creation; start slot/history is incomplete");
            p = new MiningProjection { Wallet = e.Wallet, Position = e.Position };
            db.Projections.Add(p);
        }
        if (e.BlockTime < p.LastAccrualTime) logger.LogWarning("Timestamp clamped for {Event} from {Time} to {Previous}", e.Id, e.BlockTime, p.LastAccrualTime);
        Projection.Apply(p, e);
    }
    public async Task Rebuild(CancellationToken ct = default)
    {
        logger.LogInformation("Projection rebuild starting");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await LockWriter(ct);
        await db.Projections.ExecuteDeleteAsync(ct);
        foreach (var entry in db.ChangeTracker.Entries<MiningProjection>().ToArray()) entry.State = EntityState.Detached;
        var events = await db.Events.AsNoTracking().OrderBy(e => e.Slot).ThenBy(e => e.TransactionIndex).ThenBy(e => e.EventIndex).ToListAsync(ct);
        foreach (var e in events) await Fold(e, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        logger.LogInformation("Projection rebuild finished: {Events} source events", events.Count);
    }
    private Task LockWriter(CancellationToken ct) => db.Database.IsNpgsql()
        ? db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(596332003)", ct)
        : Task.CompletedTask;
}
