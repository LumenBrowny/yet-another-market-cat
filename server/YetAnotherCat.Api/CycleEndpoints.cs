using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

public static class CycleEndpoints
{
    public static void MapCycles(this WebApplication app)
    {
        app.MapGet("/api/cycles", async (string? wallet, string? before, AccountingDb db, CycleService service, SettlementHealth health, CancellationToken ct) =>
        {
            if(wallet!=null&&!ProductApi.ValidWallet(wallet))return Results.BadRequest();
            if(before!=null&&!ValidId(before))return Results.BadRequest();
            var state = health.State;
            var cp = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(ct);
            if (state == null || cp == null) return Results.Json(new { error = "Settlement initializing" }, statusCode: 503);
            var id = Settlement.CycleId(long.Parse(state.Config.Genesis), long.Parse(state.Config.Duration), cp.ThroughTime);
            object? current = null;
            if (id != null)
            {
                var bounds = Settlement.Bounds(long.Parse(state.Config.Genesis), long.Parse(state.Config.Duration), id.Value);
                var events = wallet == null ? [] : await db.Events.AsNoTracking().Where(e => e.Wallet == wallet).ToListAsync(ct);
                var points = CycleService.Calculate(events, bounds.Start, Math.Min(bounds.End, cp.ThroughTime)).FirstOrDefault()?.PointUnits ?? "0";
                current = new { cycleId = id.ToString(), startTime = bounds.Start.ToString(), endTime = bounds.End.ToString(), status = "OPEN", currentCyclePointUnits = points, rewardBudgetBaseUnits = state.Config.Emission };
            }
            var query = db.Cycles.AsNoTracking();
            if (before != null) {
                var anchor = await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c => c.CycleId == before, ct);
                if (anchor == null) return Results.NotFound();
                query = query.Where(c => c.StartTime < anchor.StartTime);
            }
            var records = await query.OrderByDescending(c => c.StartTime).Take(21).ToListAsync(ct);
            var hasMore = records.Count > 20;
            if (hasMore) records.RemoveAt(20);
            var cycles = new List<object>(); foreach (var record in records) cycles.Add(await service.Detail(record, ct));
            return Results.Ok(new { current, cycles, nextBefore = hasMore ? records[^1].CycleId : null, finalizedChainTime = cp.ThroughTime, stale = !health.Healthy, publisherHealthy = health.Healthy, config = state.Config });
        });
        app.MapGet("/api/cycles/{id}", async (string id, AccountingDb db, CycleService service, CancellationToken ct) =>
        {
            if (!ValidId(id)) return Results.BadRequest();
            var record = await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c => c.CycleId == id, ct);
            return record == null ? Results.NotFound() : Results.Ok(await service.Detail(record, ct));
        });
        app.MapGet("/api/cycles/{id}/manifest",(string id,AccountingDb db,IManifestStorage storage,HttpContext context,CancellationToken ct)=>ProductApi.Download(id,null,db,storage,context,ct));
        app.MapGet("/api/cycles/{id}/proof/{wallet}", async (string id, string wallet, AccountingDb db, SettlementHealth health, CancellationToken ct) =>
        {
            if (!ValidId(id)) return Results.BadRequest();
            try { _ = Settlement.PublicKey(wallet); } catch (ArgumentException) { return Results.BadRequest(); }
            if (!health.Healthy) return Results.Json(new { error = "Settlement degraded" }, statusCode: 503);
            var record = await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c => c.CycleId == id, ct);
            if (record?.Status != "PUBLISHED") return Results.NotFound(new { error = "not_published" });
            var manifest = CycleService.Manifest(record); var miner = manifest.Miners.SingleOrDefault(m => m.Wallet == wallet);
            if (miner == null || miner.RewardBaseUnits == "0") return Results.NotFound(new { error = "no_reward" });
            var proofs = JsonSerializer.Deserialize<Dictionary<string, ProofNode[]>>(record.ProofsJson, HistoryReader.Json)!;
            var claimed = await db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.EventType == "cycleClaimed" && e.CycleId == id && e.Wallet == wallet, ct);
            return Results.Ok(new { cycleId = id, wallet, miner.PointUnits, miner.RewardBaseUnits, leafHash = Settlement.Leaf(id, miner), merkleRoot = record.Root, record.ManifestHash, proof = proofs[wallet], claimed = claimed != null, claimSignature = claimed?.Signature, claimedAt = claimed?.BlockTime });
        });

    }
    private static bool ValidId(string id) => ulong.TryParse(id, out var number) && number.ToString() == id;
}
