using YetAnotherCat.Accounting;

namespace YetAnotherCat.Infrastructure;

public sealed record SettlementWakeup(ulong CycleId, long EndTime, bool CanSettle, int DelayMilliseconds);
public static class SettlementSchedule
{
    public static SettlementWakeup Plan(long genesis, long duration, ulong nextCycle, long finalizedTime, long? throughTime)
    {
        var bounds = Settlement.Bounds(genesis, duration, nextCycle);
        var safeEnd = checked(bounds.End + 5);
        // Always trust the sequential on-chain nextCycle; wall time never skips backlog.
        return new(nextCycle, bounds.End, throughTime >= safeEnd,
            checked((int)(Math.Clamp(safeEnd - finalizedTime, 5, 3600) * 1000)));
    }
}
