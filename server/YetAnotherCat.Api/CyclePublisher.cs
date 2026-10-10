using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

public sealed class SettlementHealth
{
    public SettlementChainState? State { get; set; }
    public string? Error { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public bool Enabled { get; set; }
    public bool Healthy => !Enabled || Error == null && UpdatedAt > DateTimeOffset.UtcNow.AddSeconds(-45);
}
public sealed class CyclePublisher(IServiceScopeFactory scopes, IConfiguration configuration, SettlementHealth health, ILogger<CyclePublisher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Recovery owns reconciliation/publication. The API continues indexing and
        // monitoring, but must not reconcile its cached snapshot against a newer CLI write.
        if (configuration["YAC_RECOVERY_MODE"] == "true") return;
        health.Enabled = true;
        var failures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            var scheduledDelay = 60_000;
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var service = scope.ServiceProvider.GetRequiredService<CycleService>();
                var db = scope.ServiceProvider.GetRequiredService<AccountingDb>();
                var state = await service.State(stoppingToken);
                await service.Reconcile(state, stoppingToken);
                var cp = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(stoppingToken);
                var next = ulong.Parse(state.Config.NextCycle);
                var plan = SettlementSchedule.Plan(long.Parse(state.Config.Genesis), long.Parse(state.Config.Duration), next, state.FinalizedTime ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds(), cp?.ThroughTime);
                scheduledDelay = plan.DelayMilliseconds;
                if (plan.CanSettle)
                {
                    var key = configuration["YAC_PUBLISHER_KEY"];
                    if (configuration["YAC_PUBLISHER_ENABLED"] == "true" && !string.IsNullOrWhiteSpace(key)) {
                        var safety = await scope.ServiceProvider.GetRequiredService<OperationalSafety>().Get(state.Config.Publisher, stoppingToken);
                        if (safety.SolStatus != "healthy") throw new InvalidOperationException("Publisher SOL below warning threshold; publication paused");
                        if (safety.HistoryStatus == "critical") throw new InvalidOperationException("Independent verifier history coverage unavailable; publication paused");
                        await service.Publish(next, state, key, stoppingToken);
                        scheduledDelay = RecoveryPolicy.DelaySeconds(configuration["YAC_CATCHUP_DELAY_SECONDS"]) * 1000;
                    }
                    else if (configuration["YAC_RECOVERY_MODE"]!="true" && !await db.Cycles.AnyAsync(c => c.CycleId == next.ToString(), stoppingToken)) await service.Build(next, state, stoppingToken);
                }
                health.State = state; health.Error = null; health.UpdatedAt = DateTimeOffset.UtcNow;
                failures = 0;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { failures = Math.Min(failures + 1, 5); health.Error = "Settlement unavailable; inspect operator logs"; logger.LogError(ex, "Settlement failed closed; retry backoff level {Level}", failures); }
            var delay = failures == 0 ? scheduledDelay : Math.Min(300_000, 15_000 * (1 << failures));
            try { await Task.Delay(delay, stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }
}
