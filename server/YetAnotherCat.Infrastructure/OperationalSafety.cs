namespace YetAnotherCat.Infrastructure;

public sealed record SafetySnapshot(long DeploymentStartSlot, long FirstAvailableBlock, bool HistoryCoverageHealthy,
    string HistoryStatus, long PublisherLamports, string SolStatus, long FetchedAt);

public sealed class OperationalSafety(BackendSettings settings, OperationalTip rpc)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private SafetySnapshot? recent;
    public static string SolStatus(long balance, long warning, long critical) => balance < critical ? "critical" : balance < warning ? "degraded" : "healthy";
    public static string HistoryStatus(long first, long start, long margin) => first > start ? "critical" : start - first < margin ? "degraded" : "healthy";
    public async Task<SafetySnapshot> Get(string publisher, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try {
            if (recent != null && recent.FetchedAt > DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 300) return recent;
            var balance = (await rpc.Request("getBalance", [publisher, new { commitment = "finalized" }], "health", ct)).GetProperty("value").GetInt64();
            var first = (await rpc.Request("getFirstAvailableBlock", [], "health", ct, Environment.GetEnvironmentVariable("YAC_RPC_VERIFY"))).GetInt64();
            var start = settings.StartSlot ?? throw new InvalidOperationException("Deployment start slot required");
            long Threshold(string name, long fallback) => long.TryParse(Environment.GetEnvironmentVariable(name), out var value) && value > 0 ? value : fallback;
            return recent = new(start, first, first <= start, HistoryStatus(first, start, Threshold("YAC_HISTORY_WARNING_SLOTS", 216000)),
                balance, SolStatus(balance, Threshold("YAC_PUBLISHER_WARNING_LAMPORTS", 100_000_000), Threshold("YAC_PUBLISHER_CRITICAL_LAMPORTS", 20_000_000)), DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        } finally { gate.Release(); }
    }
}
