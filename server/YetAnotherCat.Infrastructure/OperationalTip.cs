using System.Net.Http.Json;
using System.Text.Json;

namespace YetAnotherCat.Infrastructure;

public sealed record FinalizedTip(long Slot, long BlockTime, string GenesisHash, long FetchedAt);

// Operational sharing only. Independent verification never receives this snapshot.
public sealed class OperationalTip(BackendSettings settings, RpcMetrics metrics, HttpClient? transport = null)
{
    private readonly HttpClient client = transport ?? new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly SemaphoreSlim gate = new(1, 1);
    private FinalizedTip? recent;
    private string? genesis;
    private DateTimeOffset identityChecked;
    public async Task<JsonElement> Request(string method, object[] parameters, string component, CancellationToken ct, string? endpoint = null)
    {
        metrics.Record(component, method, "operational");
        Console.Error.WriteLine("YAC_RPC_ATTEMPT " + JsonSerializer.Serialize(new { component, method, reason = "operational", cache = "miss", count = 1 }));
        using var response = await client.PostAsJsonAsync(endpoint ?? settings.RpcUrl, new { jsonrpc = "2.0", id = 1, method, @params = parameters }, ct);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Operational RPC {method}: HTTP {(int)response.StatusCode}");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(ct);
        if (body.TryGetProperty("error", out _)) throw new InvalidOperationException($"Operational RPC {method} refused");
        return body.GetProperty("result").Clone();
    }
    public async Task<FinalizedTip> Get(CancellationToken ct, bool forceRefresh = false)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (!forceRefresh && recent != null && recent.FetchedAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 10_000) {
                metrics.Record("shared-tip", "snapshot", "fresh", "hit"); return recent;
            }
            if (genesis == null || identityChecked < DateTimeOffset.UtcNow.AddMinutes(-5)) {
                var actual = (await Request("getGenesisHash", [], "shared-tip", ct)).GetString()!;
                if (genesis != null && genesis != actual) throw new InvalidOperationException("CRITICAL: operational genesis changed");
                var expected = Environment.GetEnvironmentVariable("YAC_GENESIS_HASH");
                if (!string.IsNullOrEmpty(expected) && expected != actual) throw new InvalidOperationException("CRITICAL: unexpected network");
                genesis = actual; identityChecked = DateTimeOffset.UtcNow;
            }
            var slot = (await Request("getSlot", [new { commitment = "finalized" }], "shared-tip", ct)).GetInt64();
            var time = (await Request("getBlockTime", [slot], "shared-tip", ct)).GetInt64();
            if (recent != null && (slot < recent.Slot || time < recent.BlockTime)) throw new InvalidOperationException("Finalized tip regressed");
            return recent = new(slot, time, genesis!, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }
        finally { gate.Release(); }
    }
}
