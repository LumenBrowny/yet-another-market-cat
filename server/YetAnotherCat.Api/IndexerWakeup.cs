using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

public sealed class IndexerWakeup
{
    private readonly SemaphoreSlim pending = new(0, 1);
    public bool Connected { get; set; }
    public DateTimeOffset? LastNotification { get; private set; }
    public DateTimeOffset? LastGapScan { get; set; }
    public void Notify()
    {
        LastNotification = DateTimeOffset.UtcNow;
        try { pending.Release(); } catch (SemaphoreFullException) { /* Coalesce duplicate/burst notifications. */ }
    }
    public Task<bool> Wait(TimeSpan timeout, CancellationToken ct) => pending.WaitAsync(timeout, ct);
}

public sealed class ProgramNotifications(BackendSettings settings, IndexerWakeup wakeup, RpcMetrics metrics, ILogger<ProgramNotifications> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var retry = 0;
        while (!stoppingToken.IsCancellationRequested) {
            try {
                using var socket = new ClientWebSocket();
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                var url = new UriBuilder(settings.RpcUrl) { Scheme = settings.RpcUrl.StartsWith("https:", StringComparison.Ordinal) ? "wss" : "ws" };
                if (url.Port == 8899 || url.Port == 9099) url.Port++;
                var endpoint = Environment.GetEnvironmentVariable("YAC_RPC_WS") ?? url.Uri.ToString();
                using var connect = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); connect.CancelAfter(TimeSpan.FromSeconds(20));
                await socket.ConnectAsync(new Uri(endpoint), connect.Token);
                var request = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method = "logsSubscribe", @params = new object[] { new { mentions = new[] { settings.ProgramId } }, new { commitment = "finalized" } } }));
                await socket.SendAsync(request, WebSocketMessageType.Text, true, stoppingToken);
                metrics.Record("indexer-wakeup", "logsSubscribe", "connect", "ws");
                var buffer = new byte[8192];
                while (socket.State == WebSocketState.Open && !stoppingToken.IsCancellationRequested) {
                    using var message = new MemoryStream();
                    WebSocketReceiveResult received;
                    do {
                        received = await socket.ReceiveAsync(buffer, stoppingToken);
                        if (received.MessageType == WebSocketMessageType.Close) throw new IOException("Subscription disconnected");
                        message.Write(buffer, 0, received.Count);
                        if (message.Length > 1024 * 1024) throw new IOException("Subscription message too large");
                    } while (!received.EndOfMessage);
                    using var doc = JsonDocument.Parse(message.ToArray());
                    var value = doc.RootElement;
                    if (value.TryGetProperty("error", out _)) throw new IOException("Subscription refused");
                    if (value.TryGetProperty("id", out _) && value.TryGetProperty("result", out _)) {
                        wakeup.Connected = true; retry = 0; wakeup.Notify();
                    }
                    if (value.TryGetProperty("method", out var method) && method.GetString() == "logsNotification") {
                        wakeup.Notify(); metrics.Record("indexer-wakeup", "notification", "finalized-log", "ws");
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Program subscription disconnected ({Type}); finalized gap scanning continues", ex.GetType().Name); }
            finally { wakeup.Connected = false; }
            retry = Math.Min(retry + 1, 6);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Min(60, 1 << retry)), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
