using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

// Supplies lifecycle/reserve reads while all settlement work stays disabled.
// No reconciliation, building, publication or signing is performed here.
public sealed class ReadOnlySettlementState(IServiceScopeFactory scopes, SettlementHealth health,
    ILogger<ReadOnlySettlementState> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        health.Enabled = true;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                health.State = await scope.ServiceProvider.GetRequiredService<CycleService>().State(stoppingToken);
                health.Error = null;
                health.UpdatedAt = DateTimeOffset.UtcNow;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                health.Error = "Read-only chain state unavailable";
                logger.LogWarning(ex, "Read-only chain state deferred");
            }
            try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
}
