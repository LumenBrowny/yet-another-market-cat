using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;

namespace YetAnotherCat.Infrastructure;

public sealed class Snapshots(AccountingDb db, CurrentCycleClock? clock = null)
{
    public async Task<object?> Miner(string wallet, bool healthy, long latestSlot, CancellationToken ct = default)
    {
        // Projection and finalized watermark must be read from the same DB snapshot.
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var cp = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(ct);
        if (cp == null) return null;
        var p = await db.Projections.AsNoTracking().SingleOrDefaultAsync(p => p.Wallet == wallet, ct);
        var units = p == null ? 0 : Points.Integer(p.Units) + Points.Accrue(Points.Integer(p.Rate), p.LastAccrualTime, cp.ThroughTime);
        long? cycleStart = null, cycleEnd = null;
        string? cycleId = null, cycleUnits = null;
        if (clock?.Configuration is { } rewards) {
            var id = Settlement.CycleId(long.Parse(rewards.Genesis), long.Parse(rewards.Duration), cp.ThroughTime);
            if (id != null) {
                var bounds = Settlement.Bounds(long.Parse(rewards.Genesis), long.Parse(rewards.Duration), id.Value);
                var events = await db.Events.AsNoTracking().Where(e => e.Wallet == wallet).ToListAsync(ct);
                cycleUnits = CycleService.Calculate(events, bounds.Start, cp.ThroughTime).SingleOrDefault()?.PointUnits ?? "0";
                cycleId = id.ToString(); cycleStart = bounds.Start; cycleEnd = bounds.End;
            }
        }
        return new
        {
            wallet,
            position = p?.Position,
            effectiveLockedBaseUnits = p?.Locked ?? "0",
            effectiveLockedCatshit = Points.Format(Points.Integer(p?.Locked ?? "0"), 6),
            tier = p?.Tier ?? "DEAD_INSIDE",
            multiplier = Points.Format(Points.Integer(p?.Rate ?? "0")),
            pointUnits = units.ToString(System.Globalization.CultureInfo.InvariantCulture),
            pointScale = "1000",
            currentCycleId = cycleId,
            currentCyclePointUnits = cycleUnits,
            currentCycleStart = cycleStart,
            currentCycleEnd = cycleEnd,
            poopPoints = Points.Format(units),
            ratePointUnitsPerSecond = p?.Rate ?? "0",
            storedPointUnits = p?.Units ?? "0",
            lastAccrualTimestamp = p?.LastAccrualTime,
            lastProcessedSlot = p?.LastProcessedSlot,
            lastFinalizedChainTime = cp.ThroughTime,
            accountingFinalizedThroughTime = cp.ThroughTime,
            accountingFinalizedThroughSlot = cp.ThroughSlot,
            indexerLagSlots = Math.Max(0, latestSlot - cp.ThroughSlot),
            stale = !healthy || latestSlot > cp.ThroughSlot + 250,
            pendingWithdrawBaseUnits = p?.Pending ?? "0",
            withdrawRequestedAt = p?.WithdrawRequestedAt,
            programId = cp.ProgramId,
            mint = cp.Mint,
            genesisHash = cp.GenesisHash
        };
    }
    public async Task<object> Inspect(string wallet, CancellationToken ct = default)
    {
        var events = await db.Events.AsNoTracking().Where(e => e.Wallet == wallet).OrderBy(e => e.Slot).ThenBy(e => e.TransactionIndex).ThenBy(e => e.EventIndex).ToListAsync(ct);
        var p = new MiningProjection { Wallet = wallet, Position = events.FirstOrDefault(e => e.EventType == "positionCreated")?.Position ?? "" };
        var intervals = new List<object>();
        foreach (var e in events.Where(e => e.EventType is "positionCreated" or "deposited" or "withdrawRequested" or "withdrawExecuted"))
        {
            var before = Points.Integer(p.Units);
            var start = p.LastAccrualTime;
            var rate = p.Rate;
            Projection.Apply(p, e);
            intervals.Add(new { from = start, to = p.LastAccrualTime, rateUnits = rate, accruedDelta = (Points.Integer(p.Units) - before).ToString(), timestamp = e.BlockTime, e.EventType, e.Slot, e.TransactionIndex, e.EventIndex, effectiveLocked = p.Locked, p.Tier });
        }
        return new { wallet, events, intervals, projection = p, snapshot = await Miner(wallet, false, 0, ct) };
    }
}
