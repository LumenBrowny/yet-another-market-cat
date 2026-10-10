using System.Diagnostics;
using System.Text.Json;
using YetAnotherCat.Infrastructure;
using Xunit;

namespace YetAnotherCat.Tests;

[CollectionDefinition("Verifier process environment", DisableParallelization = true)]
public sealed class VerifierProcessEnvironment;

[Collection("Verifier process environment")]
public sealed class VerifierProcessTimeoutTests
{
    public sealed class ProcessFactAttribute : FactAttribute
    {
        public ProcessFactAttribute()
        {
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("YAC_TEST_PROCESS_ROOT")))
                Skip = "Opt-in 60-second Node process-tree timeout test; requires repository node_modules";
        }
    }

    [ProcessFact]
    public async Task TimedOutVerifierAndItsChildAreStopped()
    {
        var repository = Path.GetFullPath(Environment.GetEnvironmentVariable("YAC_TEST_PROCESS_ROOT")!);
        Assert.True(Directory.Exists(Path.Combine(repository, "node_modules", "tsx")));
        var fixture = Path.Combine(repository, "temp", "recovery-timeout-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(fixture, "scripts"));
        await File.WriteAllTextAsync(Path.Combine(fixture, "scripts", "rpc-metrics.mjs"), "// no network instrumentation in this fixture\n");
        await File.WriteAllTextAsync(Path.Combine(fixture, "scripts", "settlement-bridge.ts"), """
            import { spawn } from 'node:child_process';
            import { writeFileSync } from 'node:fs';
            const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
            writeFileSync('processes.json', JSON.stringify([process.pid, child.pid]));
            process.stdin.resume();
            setInterval(() => {}, 1000);
            """);
        var prior = Environment.GetEnvironmentVariable("YAC_VERIFY_TIMEOUT_SECONDS");
        var watch = Stopwatch.StartNew();
        try
        {
            Environment.SetEnvironmentVariable("YAC_VERIFY_TIMEOUT_SECONDS", "60");
            var bridge = new SettlementBridge(new BackendSettings(fixture, "http://127.0.0.1:1", "fixture", 0, null));
            using var outer = new CancellationTokenSource(TimeSpan.FromSeconds(85));
            var error = await Assert.ThrowsAsync<TimeoutException>(() => bridge.Call("verify-chain", ct: outer.Token));
            Assert.Contains("exceeded 60s", error.Message);
            Assert.InRange(watch.Elapsed.TotalSeconds, 59, 80);
            var processes = JsonSerializer.Deserialize<int[]>(await File.ReadAllTextAsync(Path.Combine(fixture, "processes.json")))!;
            Assert.Equal(2, processes.Length);
            await Task.Delay(250);
            foreach (var id in processes) Assert.False(Running(id), $"Verifier descendant {id} survived timeout");
        }
        finally
        {
            Environment.SetEnvironmentVariable("YAC_VERIFY_TIMEOUT_SECONDS", prior);
            var evidence = Path.Combine(fixture, "processes.json");
            if (File.Exists(evidence))
                foreach (var id in JsonSerializer.Deserialize<int[]>(await File.ReadAllTextAsync(evidence))!)
                    if (Running(id)) { using var p = Process.GetProcessById(id); p.Kill(true); }
        }
    }

    private static bool Running(int id)
    {
        try { using var process = Process.GetProcessById(id); return !process.HasExited; }
        catch (ArgumentException) { return false; }
    }
}
