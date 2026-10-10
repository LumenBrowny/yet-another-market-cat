using System.Diagnostics;
using System.Text.Json;

namespace YetAnotherCat.Infrastructure;

public sealed record BackendSettings(string Root, string RpcUrl, string ProgramId, long? StartSlot, string? DeploymentSignature);
public class HistoryReader(BackendSettings settings, OperationalTip? tip = null, RpcMetrics? metrics = null)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public virtual async Task<HistoryBatch> Read(long checkpoint, CancellationToken ct, long? checkpointStartSlot = null, string reason = "gap")
    {
        var info = new ProcessStartInfo("node") { WorkingDirectory = settings.Root, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in new[] { "--import", "./scripts/rpc-metrics.mjs", "--import", "tsx", "scripts/chain-history.ts", "--stdio" }) info.ArgumentList.Add(arg);
        info.Environment["YAC_RPC_COMPONENT"] = reason == "wakeup" ? "indexer-wakeup" : "indexer-backfill";
        info.Environment["YAC_RPC_REASON"] = reason;
        var operationalTip = tip == null ? null : await tip.Get(ct, reason == "wakeup");
        using var process = Process.Start(info) ?? throw new InvalidOperationException("Cannot start chain decoder");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(5));
        using var registration = timeout.Token.Register(() => { try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } });
        var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var errors = process.StandardError.ReadToEndAsync(timeout.Token);
        await process.StandardInput.WriteAsync(JsonSerializer.Serialize(new { checkpoint, startSlot = settings.StartSlot ?? checkpointStartSlot, endpoint = settings.RpcUrl, programId = settings.ProgramId, deploymentSignature = settings.DeploymentSignature, operationalTip }, Json));
        process.StandardInput.Close();
        await process.WaitForExitAsync(timeout.Token);
        var error = await errors;
        metrics?.Observe(error);
        if (process.ExitCode != 0) throw new InvalidOperationException("Chain reader failed: " + string.Join('\n', error.Split('\n').Where(l => !l.StartsWith("YAC_RPC_"))).Replace(settings.RpcUrl, "[RPC endpoint]"));
        foreach (var line in error.Split('\n').Where(l => l.StartsWith("YAC_RPC_METRICS "))) Console.Error.WriteLine(line);
        return JsonSerializer.Deserialize<HistoryBatch>(await output, Json) ?? throw new InvalidOperationException("Empty chain reader result");
    }
}
