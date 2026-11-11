using YetAnotherCat.Accounting;
namespace YetAnotherCat.Infrastructure;

// Earliest possible exhaustion assumes every unpublished cycle is nonempty.
// Empty publications move this horizon forward; ordinary daily publication does
// not pause PP. A delayed final publication can never extend it past funded time.
public static class RewardLifecycle
{
    public static bool Prepared(RewardConfiguration r) => r.LaunchMode && r.ActivatedAt == "0";
    public static bool Complete(RewardConfiguration r) => r.LaunchMode && r.PpCutoff != "0";
    public static long? Horizon(RewardConfiguration r)
    {
        if (!r.LaunchMode) return null;
        if (Prepared(r)) return 0;
        if (Complete(r)) return long.Parse(r.PpCutoff);
        var remaining = Points.Integer("99000000000000") - Points.Integer(r.TotalAllocated);
        var emission = Points.Integer(r.Emission);
        if (remaining <= 0 || emission <= 0 || remaining % emission != 0)
            throw new InvalidOperationException("Invalid finite distribution state");
        var fundedCycles = checked((ulong)(remaining / emission));
        return Settlement.Bounds(long.Parse(r.Genesis), long.Parse(r.Duration),
            checked(ulong.Parse(r.NextCycle) + fundedCycles - 1)).End;
    }
    public static string Status(RewardConfiguration r, long time) => Prepared(r) || r.LaunchMode && time < long.Parse(r.Genesis) ? "PREPARED" : Complete(r) ? "COMPLETE"
        : r.LaunchMode && time >= Horizon(r) ? "FINALIZING" : "ACTIVE";
    public static void RequireBuild(RewardConfiguration r, ulong id)
    {
        if (Prepared(r) || Complete(r) && id >= ulong.Parse(r.NextCycle))
            throw new InvalidOperationException("No new cycles outside active distribution");
    }
}
