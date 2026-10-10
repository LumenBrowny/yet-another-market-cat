using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using YetAnotherCat.Accounting;

namespace YetAnotherCat.Infrastructure;

public sealed record RewardConfiguration(string TokenMint, string Publisher, string Genesis, string Duration, string Emission, string CommittedUnclaimed, string NextCycle);
public sealed record PublishedCycle(string CycleId, string Start, string End, byte[] Root, byte[] ManifestHash, byte[] TotalPoints, string Budget, string TotalAllocated, string ClaimedAmount, int LeafCount, string PublishedAt, string Publisher, string Address);
// JS emits byte arrays as arrays, whereas System.Text.Json treats byte[] as base64.
public sealed record SettlementChainState(RewardConfiguration Config, string GenesisHash, string ProgramId, string VaultBalance, JsonElement[] Cycles, long LatestFinalizedSlot = 0, long? FinalizedTime = null, double RpcLatencyMs = 0, string? UpgradeAuthority = null, string? FaucetDistributed = null);
public sealed class SettlementBridge(BackendSettings settings, IServiceScopeFactory? scopes = null, OperationalTip? tip = null, RpcMetrics? metrics = null, CurrentCycleClock? clock = null)
{
    private readonly SemaphoreSlim stateGate = new(1, 1);
    private readonly SemaphoreSlim verificationGate = new(1, 1);
    private JsonElement? recentState;
    private DateTimeOffset stateFetched;
    public object? LastVerification { get; private set; }
    public async Task<JsonElement> Call(string command, CycleManifest? manifest = null, string? publisherFile = null, CancellationToken ct = default, string? canonical = null, string? component = null)
    {
        if (command == "state") {
            await stateGate.WaitAsync(ct);
            try {
                if (recentState != null && stateFetched > DateTimeOffset.UtcNow.AddSeconds(-15)) { metrics?.Record("state", "snapshot", "request", "hit"); return recentState.Value; }
                metrics?.Record("state", "snapshot", "request", "miss");
                JsonElement result;
                if (scopes != null) {
                    await using var scope = scopes.CreateAsyncScope();
                    result = await CycleProjectionStore.Refresh(scope.ServiceProvider.GetRequiredService<AccountingDb>(),
                        () => CallCore(command, manifest, publisherFile, ct, canonical),
                        (operation, from, to) => CallCore(operation, null, null, ct, null, from, to), ct);
                } else result = await CallCore(command, manifest, publisherFile, ct, canonical);
                recentState = result; stateFetched = DateTimeOffset.UtcNow;
                if (clock != null) clock.Configuration = result.GetProperty("config").Deserialize<RewardConfiguration>(HistoryReader.Json);
                return result;
            } finally { stateGate.Release(); }
        }
        if (command is "verify-chain" or "verify-before-publish" or "verify-batch") {
            await verificationGate.WaitAsync(ct);
            try { return await CallCore(command, manifest, publisherFile, ct, canonical, component: component); }
            finally { verificationGate.Release(); }
        }
        var response = await CallCore(command, manifest, publisherFile, ct, canonical);
        if (command == "publish") {
            await stateGate.WaitAsync(ct);
            try { recentState = null; } finally { stateGate.Release(); }
        }
        return response;
    }
    private async Task<JsonElement> CallCore(string command, CycleManifest? manifest, string? publisherFile, CancellationToken ct, string? canonical, long? from = null, long? to = null, string? component = null)
    {
        var info = new ProcessStartInfo("node") { WorkingDirectory = settings.Root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in new[] { "--import", "./scripts/rpc-metrics.mjs", "--import", "tsx", "scripts/settlement-bridge.ts" }) info.ArgumentList.Add(arg);
        info.Environment["YAC_RPC_COMPONENT"] = component ?? (command switch { "verify-before-publish" => "verifier-pre", "verify-chain" => "verifier-post", "publish" => "publisher", _ => command });
        info.Environment["YAC_RPC_REASON"] = command;
        info.Environment["YAC_RPC_CYCLE"] = manifest?.CycleId ?? "";
        var operationalTip = command == "state" && tip != null ? await tip.Get(ct) : null;
        var timeoutSeconds = RecoveryPolicy.TimeoutSeconds(command, Environment.GetEnvironmentVariable("YAC_VERIFY_TIMEOUT_SECONDS"));
        using var p = Process.Start(info) ?? throw new InvalidOperationException("Cannot start settlement bridge");
        var began = Stopwatch.StartNew();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));
        using var registration = timeout.Token.Register(() => { try { p.Kill(true); } catch (InvalidOperationException) { } });
        var output = p.StandardOutput.ReadToEndAsync(timeout.Token); var errors = p.StandardError.ReadToEndAsync(timeout.Token);
        var endpoint = command is "verify-chain" or "verify-before-publish" or "verify-batch" ? Environment.GetEnvironmentVariable("YAC_RPC_VERIFY") ?? settings.RpcUrl : settings.RpcUrl;
        await p.StandardInput.WriteAsync(JsonSerializer.Serialize(new { command, endpoint, startSlot = settings.StartSlot, manifest, publisherFile, canonical, fromCycle = from?.ToString(), toCycle = to?.ToString(), operationalTip }, HistoryReader.Json)); p.StandardInput.Close();
        try { await p.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) {
            if (!p.HasExited) p.Kill(true);
            await p.WaitForExitAsync(CancellationToken.None);
            try { await Task.WhenAll(output, errors); } catch (OperationCanceledException) { }
            LastVerification = new { command, cycleId=manifest?.CycleId, result="TIMEOUT", durationSeconds=began.Elapsed.TotalSeconds };
            throw new TimeoutException($"{command} exceeded {timeoutSeconds}s; child process stopped; publication must remain fail-closed");
        }
        var error = await errors;
        metrics?.Observe(error);
        if (p.ExitCode != 0) throw new InvalidOperationException("Settlement bridge: " + string.Join('\n', error.Split('\n').Where(l => !l.StartsWith("YAC_RPC_"))).Replace(endpoint, "[RPC endpoint]"));
        foreach (var line in error.Split('\n').Where(l => l.StartsWith("YAC_RPC_METRICS "))) Console.Error.WriteLine(line);
        var parsed = JsonSerializer.Deserialize<JsonElement>(await output);
        if (RecoveryPolicy.IsVerification(command)) {
            LastVerification = new { command, cycleId=manifest?.CycleId, durationSeconds=began.Elapsed.TotalSeconds, report=parsed };
            Console.Error.WriteLine("YAC_VERIFICATION " + JsonSerializer.Serialize(LastVerification, HistoryReader.Json));
            var evidenceFile=Path.Combine(settings.Root,".dev","last-verification.json");
            var temporary=evidenceFile+"."+Guid.NewGuid().ToString("N")+".tmp";
            await File.WriteAllTextAsync(temporary,JsonSerializer.Serialize(LastVerification,HistoryReader.Json),ct);
            File.Move(temporary,evidenceFile,true);
        }
        return parsed;
    }
}
public sealed class CycleRecord
{
    public string CycleId { get; set; } = "";
    public long StartTime { get; set; }
    public long EndTime { get; set; }
    public string Status { get; set; } = "CALCULATED";
    public string ManifestJson { get; set; } = "";
    public string ManifestHash { get; set; } = "";
    public string Root { get; set; } = "";
    public string ProofsJson { get; set; } = "";
    public string PublicationSignature { get; set; } = "";
    public long PublishedSlot { get; set; }
    public string Address { get; set; } = "";
    public long InputThroughSlot { get; set; }
    public string InputHash { get; set; } = "";
}
