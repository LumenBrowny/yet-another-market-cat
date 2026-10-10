using System.Collections.Concurrent;
using System.Text.Json;

namespace YetAnotherCat.Infrastructure;

public sealed class RpcMetrics
{
    private readonly ConcurrentDictionary<(long Minute, string Component, string Method, string Reason, string Cache), long> counters = new();
    public void Record(string component, string method, string reason, string cache = "miss", long count = 1)
    {
        var minute = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60;
        counters.AddOrUpdate((minute, component, method, reason, cache), count, (_, old) => old + count);
        if (method == "snapshot" || cache == "ws") Console.Error.WriteLine("YAC_RUNTIME_EVENT " + JsonSerializer.Serialize(new { component, method, reason, cache, count }));
        foreach (var key in counters.Keys.Where(k => k.Minute < minute - 60)) counters.TryRemove(key, out _);
    }
    public void Observe(string stderr)
    {
        foreach (var line in stderr.Split('\n').Where(l => l.StartsWith("YAC_RPC_ATTEMPT ")))
        {
            var e = JsonSerializer.Deserialize<JsonElement>(line[16..]);
            Record(e.GetProperty("component").GetString()!, e.GetProperty("method").GetString()!, e.GetProperty("reason").GetString()!);
            Console.Error.WriteLine(line);
        }
    }
    public object Snapshot() => new { window = "current and previous 59 UTC minute buckets", calls = counters
        .Where(p => p.Key.Minute > DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 60 - 60)
        .GroupBy(p => new { p.Key.Component, p.Key.Method, p.Key.Reason, p.Key.Cache })
        .Select(g => new { g.Key.Component, g.Key.Method, g.Key.Reason, g.Key.Cache, count = g.Sum(p => p.Value) }).ToArray() };
}
