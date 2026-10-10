using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

public sealed record IndexerState(bool RpcReachable, long LatestSlot, DateTimeOffset? LastSuccess, string? Error);
public sealed class IndexerHealth
{
    public int FreshnessSeconds { get; set; } = 15;
    public IndexerState State { get; set; } = new(false, 0, null, "Indexer starting");
    public bool Healthy => State.Error == null && State.LastSuccess > DateTimeOffset.UtcNow.AddSeconds(-FreshnessSeconds);
}
public sealed class Indexer(IServiceScopeFactory scopes, HistoryReader reader, IndexerHealth health, ILogger<Indexer> logger, IConfiguration configuration, IndexerWakeup wakeup) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval=int.TryParse(configuration["YAC_INDEXER_GAP_MS"],out var configured)?Math.Clamp(configured,10000,60000):60000;
        health.FreshnessSeconds=Math.Max(15,interval/1000*3);
        var reason = "startup";
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AccountingDb>();
                var cp = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(stoppingToken);
                var batch = await reader.Read(cp?.ThroughSlot ?? 0, stoppingToken, cp?.StartSlot, reason);
                health.State = health.State with { RpcReachable = true, LatestSlot = batch.ThroughSlot };
                await scope.ServiceProvider.GetRequiredService<EventStore>().Ingest(batch, stoppingToken);
                health.State = new(true, batch.ThroughSlot, DateTimeOffset.UtcNow, null);
                if (reason != "wakeup") wakeup.LastGapScan = DateTimeOffset.UtcNow;
                logger.LogDebug("Finalized checkpoint {Slot}, {Time}", batch.ThroughSlot, batch.ThroughTime);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                health.State = health.State with { RpcReachable = false, Error = "Indexer cannot advance; inspect backend logs" };
                logger.LogError(ex, "Indexer deferred; checkpoint unchanged");
            }
            try {
                var due = wakeup.LastGapScan?.AddMilliseconds(interval) ?? DateTimeOffset.UtcNow;
                var remaining = due - DateTimeOffset.UtcNow;
                if (remaining <= TimeSpan.Zero && health.State.Error != null) remaining = TimeSpan.FromSeconds(5);
                reason = remaining > TimeSpan.Zero && await wakeup.Wait(remaining, stoppingToken) ? "wakeup" : "gap";
                if (DateTimeOffset.UtcNow >= due) reason = "gap";
                if (reason == "wakeup") await Task.Delay(2000, stoppingToken);
            } catch (OperationCanceledException) { break; }
        }
    }
}
