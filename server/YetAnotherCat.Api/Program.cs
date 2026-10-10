using System.Text.Json;
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;
using YetAnotherCat.Api;
using YetAnotherCat.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
var root = Environment.GetEnvironmentVariable("YAC_ROOT") ?? Directory.GetCurrentDirectory();
while (!File.Exists(Path.Combine(root, "package.json"))) root = Directory.GetParent(root)?.FullName ?? throw new InvalidOperationException("Run from the repository or set YAC_ROOT");
var deploymentPath = builder.Configuration["YAC_DEPLOYMENT_FILE"] ?? Path.Combine(root, ".dev", "deployment.json");
using var deployment = File.Exists(deploymentPath) ? JsonDocument.Parse(File.ReadAllText(deploymentPath)) : null;
string? Metadata(string key) => deployment?.RootElement.TryGetProperty(key, out var value) == true ? value.GetString() : null;
var programId = builder.Configuration["SOLANA_PROGRAM_ID"] ?? Metadata("programId") ?? throw new InvalidOperationException("SOLANA_PROGRAM_ID required");
var startSlotText = builder.Configuration["SOLANA_START_SLOT"] ?? (deployment?.RootElement.TryGetProperty("startSlot", out var startValue) == true ? startValue.ToString() : null);
var settings = new BackendSettings(root, builder.Configuration["YAC_RPC_PRIMARY"] ?? builder.Configuration["SOLANA_RPC_URL"] ?? "http://127.0.0.1:8899", programId, startSlotText == null ? null : long.Parse(startSlotText), Metadata("signature"));
if (IPAddress.TryParse(builder.Configuration["YAC_TRUSTED_PROXY"], out var proxy))
    builder.Services.Configure<ForwardedHeadersOptions>(o => {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        o.KnownProxies.Add(proxy); o.ForwardLimit = 1;
    });
Directory.CreateDirectory(Path.Combine(root, ".dev"));
var provider = builder.Configuration["DATABASE_PROVIDER"] ?? "sqlite";
var connection = builder.Configuration["DATABASE_CONNECTION_STRING"] ?? $"Data Source={Path.Combine(root, ".dev", "accounting.db")}";
builder.Services.AddDbContext<AccountingDb>(options =>
{
    if (provider == "postgres") options.UseNpgsql(connection);
    else if (provider == "sqlite") options.UseSqlite(connection);
    else throw new InvalidOperationException("DATABASE_PROVIDER must be sqlite or postgres");
});
builder.AddProduct(root);
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton<RpcMetrics>();
builder.Services.AddSingleton<OperationalTip>();
builder.Services.AddSingleton<OperationalSafety>();
builder.Services.AddSingleton<CurrentCycleClock>();
builder.Services.AddSingleton<IndexerWakeup>();
builder.Services.AddSingleton<HistoryReader>();
builder.Services.AddSingleton<IndexerHealth>();
builder.Services.AddScoped<EventStore>();
builder.Services.AddScoped<Snapshots>();
builder.Services.AddSingleton<SettlementBridge>();
builder.Services.AddSingleton<SettlementHealth>();
builder.Services.AddScoped<CycleService>();
var command = args.FirstOrDefault(a => a is "migrate" or "rebuild-projections" or "inspect" or "sync-once" or "build-cycle" or "publish-cycle" || ProductCommands.Names.Contains(a));
if (command == null)
{
    builder.Services.AddHostedService<Indexer>();
    builder.Services.AddHostedService<ProgramNotifications>();
    if (builder.Configuration["YAC_SETTLEMENT_ENABLED"] == "true") { builder.Services.AddHostedService<CyclePublisher>(); builder.Services.AddHostedService<OperationsMonitor>(); if(builder.Configuration["YAC_RECOVERY_MODE"]!="true")builder.Services.AddHostedService<VerificationWorker>(); }
}
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);
var app = builder.Build();
app.UseForwardedHeaders();
app.UseProductSecurity();
await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AccountingDb>();
    for (var attempt = 0; ; attempt++) {
        try { await db.Database.MigrateAsync(); break; }
        catch (Exception) when (attempt < 5) { await Task.Delay(TimeSpan.FromSeconds(5)); }
    }
    if (command != null)
    {
        if (ProductCommands.Names.Contains(command)) { await ProductCommands.Run(command,args,scope.ServiceProvider); return; }
        if (command is "build-cycle" or "publish-cycle")
        {
            var id = ulong.Parse(args[Array.IndexOf(args, command) + 1]);
            var cycles = scope.ServiceProvider.GetRequiredService<CycleService>();
            var state = await cycles.State();
            var result = command == "build-cycle" ? await cycles.Build(id, state) : await cycles.Publish(id, state, builder.Configuration["YAC_PUBLISHER_KEY"] ?? throw new InvalidOperationException("Publisher key required"));
            Console.WriteLine(result.ManifestJson);
        }
        if (command == "rebuild-projections") await scope.ServiceProvider.GetRequiredService<EventStore>().Rebuild();
        if (command == "sync-once")
        {
            var cp = await db.Checkpoints.SingleOrDefaultAsync();
            var batch = await scope.ServiceProvider.GetRequiredService<HistoryReader>().Read(cp?.ThroughSlot ?? 0, CancellationToken.None, cp?.StartSlot);
            await scope.ServiceProvider.GetRequiredService<EventStore>().Ingest(batch);
        }
        if (command == "inspect")
        {
            var wallet = args.ElementAtOrDefault(Array.IndexOf(args, "inspect") + 1) ?? throw new InvalidOperationException("inspect <wallet>");
            Console.WriteLine(JsonSerializer.Serialize(await scope.ServiceProvider.GetRequiredService<Snapshots>().Inspect(wallet), new JsonSerializerOptions(HistoryReader.Json) { WriteIndented = true }));
        }
        return;
    }
}
app.MapGet("/api/live", () => Results.Ok(new {status="alive"}));
app.MapGet("/api/config", async (AccountingDb db) => new { programId, pointScale = "1000", commitment = "finalized", tiers = Points.Tiers, chain = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync() });
app.MapGet("/api/indexer/status", async (AccountingDb db, IndexerHealth health) =>
{
    var cp = await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync();
    return new { healthy = health.Healthy, latestRpcFinalizedSlot = health.State.LatestSlot, lastProcessedSlot = cp?.ThroughSlot, lagSlots = cp == null ? (long?)null : Math.Max(0, health.State.LatestSlot - cp.ThroughSlot), lastProcessedBlockTime = cp?.ThroughTime, health.State.LastSuccess, health.State.Error };
});
app.MapGet("/api/health", (IndexerHealth indexer,SettlementHealth settlement,OperationsState operations) => {
    var fresh=operations.UpdatedAt>DateTimeOffset.UtcNow.AddSeconds(-75).ToUnixTimeSeconds();
    var status=!fresh?"degraded":operations.Status;
    return Results.Json(new {status,apiAlive=true,indexerHealthy=indexer.Healthy,cyclePublisherHealthy=settlement.Healthy,components=fresh?operations.Components:new {status="degraded",detail="Operational checks unavailable or stale"}},statusCode:status=="healthy"?200:503);
});
async Task<IResult> Miner(string wallet, Snapshots snapshots, IndexerHealth health, CancellationToken ct)
{
    if (!ProductApi.ValidWallet(wallet)) return Results.BadRequest(new { error = "Invalid wallet address" });
    var snapshot = await snapshots.Miner(wallet, health.Healthy, health.State.LatestSlot, ct);
    return snapshot == null ? Results.Json(new { error = "Accounting initializing" }, statusCode: 503) : Results.Ok(snapshot);
}
app.MapGet("/api/miners/{wallet}", Miner);
app.MapGet("/api/miners/{wallet}/accounting", Miner);
if (app.Environment.IsDevelopment()) app.MapGet("/api/debug/miners/{wallet}/timeline", async (string wallet, Snapshots snapshots) => await snapshots.Inspect(wallet));
app.MapCycles();
app.MapProduct(root);
await app.RunAsync();
