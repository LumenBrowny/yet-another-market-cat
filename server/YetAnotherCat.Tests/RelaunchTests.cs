using System.Net;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using YetAnotherCat.Api;
using YetAnotherCat.Infrastructure;
using Xunit;

namespace YetAnotherCat.Tests;

public sealed class RelaunchTests
{
    private static JsonElement Cycle(long id, string claimed = "0", string root = "unchanged") => JsonSerializer.SerializeToElement(new { cycleId = id.ToString(), root, claimedAmount = claimed });
    private static JsonElement State(long next, string program = "program") => JsonSerializer.SerializeToElement(new { programId = program, genesisHash = "genesis", config = new { tokenMint = "mint", nextCycle = next.ToString() }, cycles = Array.Empty<object>() });
    [Theory]
    [InlineData(10)] [InlineData(100)] [InlineData(1000)] [InlineData(5000)]
    public async Task WarmStateAndRestartNeverFetchHistoricalAccounts(int count)
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AccountingDb>().UseSqlite(connection).Options;
        await using (var db = new AccountingDb(options)) {
            await db.Database.MigrateAsync();
            db.CycleProjectionCheckpoints.Add(new() { ProgramId = "program", GenesisHash = "genesis", Mint = "mint", NextCycle = count, AuditedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() });
            for (var i = 0; i < count; i++) { var value = CycleProjectionStore.Immutable(Cycle(i)); db.PublishedCycleProjections.Add(new() { CycleId = i, ImmutableJson = value, Hash = CycleProjectionStore.Hash(value) }); }
            await db.SaveChangesAsync();
        }
        for (var restart = 0; restart < 2; restart++) {
            await using var db = new AccountingDb(options);
            var calls = 0;
            var state = await CycleProjectionStore.Merge(db, State(count), (_,_,_) => { calls++; throw new Exception("Historical fetch in warm state"); }, default);
            Assert.Equal(0, calls); Assert.Equal(count, state.GetProperty("cycles").GetArrayLength());
        }
    }
    [Fact]
    public async Task DiscoveryOnlyFetchesMissingRangeAndAuditRejectsImmutableMismatch()
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new AccountingDb(new DbContextOptionsBuilder<AccountingDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        await CycleProjectionStore.Merge(db, State(101), (_,from,to) => Task.FromResult(JsonSerializer.SerializeToElement(Enumerable.Range((int)from,(int)(to-from)).Select(i => Cycle(i)))), default);
        var ranges = new List<(string, long, long)>();
        await CycleProjectionStore.Merge(db, State(104), (command,from,to) => { ranges.Add((command,from,to)); return Task.FromResult(JsonSerializer.SerializeToElement(Enumerable.Range((int)from,(int)(to-from)).Select(i => Cycle(i)))); }, default);
        Assert.Equal(new[] { ("cycle-discovery",101L,104L) }, ranges);
        Assert.Equal(104, (await db.CycleProjectionCheckpoints.SingleAsync()).NextCycle);
        (await db.CycleProjectionCheckpoints.SingleAsync()).AuditedAt = 0; await db.SaveChangesAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(() => CycleProjectionStore.Merge(db, State(104), (_,_,_) => Task.FromResult(JsonSerializer.SerializeToElement(Enumerable.Range(0,104).Select(i => Cycle(i, "1", i == 3 ? "tampered" : "unchanged")))), default));
        Assert.Equal("unchanged", JsonSerializer.Deserialize<JsonElement>((await db.PublishedCycleProjections.SingleAsync(c => c.CycleId == 3)).ImmutableJson).GetProperty("root").GetString());
    }
    [Fact]
    public void MutableClaimsDoNotChangeImmutableProjectionAndCorruptionFailsClosed()
    {
        Assert.Equal(CycleProjectionStore.Immutable(Cycle(0)), CycleProjectionStore.Immutable(Cycle(0,"900")));
        Assert.Throws<InvalidOperationException>(() => CycleProjectionStore.Validate([new() { CycleId=0, ImmutableJson="{}", Hash="invalid" }],1));
        Assert.Throws<InvalidOperationException>(() => CycleProjectionStore.Validate([],1));
    }
    [Fact]
    public async Task NewDeploymentCannotReuseOldProjection()
    {
        using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new AccountingDb(new DbContextOptionsBuilder<AccountingDb>().UseSqlite(connection).Options); await db.Database.EnsureCreatedAsync();
        await CycleProjectionStore.Merge(db, State(0), (_,_,_) => throw new Exception(), default);
        await Assert.ThrowsAsync<InvalidOperationException>(() => CycleProjectionStore.Merge(db, State(0,"other"), (_,_,_) => throw new Exception(), default));
    }
    [Fact]
    public async Task DuplicateWakeupsCoalesceAndDisconnectDoesNotDisableGapTimer()
    {
        var signal = new IndexerWakeup { Connected = true };
        signal.Notify(); signal.Notify(); signal.Notify();
        Assert.True(await signal.Wait(TimeSpan.Zero, default));
        signal.Connected = false;
        Assert.False(await signal.Wait(TimeSpan.FromMilliseconds(10), default));
        signal.Notify(); Assert.True(await signal.Wait(TimeSpan.Zero, default));
    }
    [Theory]
    [InlineData(10,100,20,"critical")]
    [InlineData(50,100,20,"degraded")]
    [InlineData(100,100,20,"healthy")]
    public void PublisherBalanceAlerts(long balance,long warning,long critical,string status) => Assert.Equal(status,OperationalSafety.SolStatus(balance,warning,critical));
    [Theory]
    [InlineData(101,100,10,"critical")]
    [InlineData(95,100,10,"degraded")]
    [InlineData(50,100,10,"healthy")]
    public void CoverageAlerts(long first,long start,long margin,string status) => Assert.Equal(status,OperationalSafety.HistoryStatus(first,start,margin));
    [Fact]
    public void ScheduledPublisherWaitsForBoundaryAndRecoversOldestBacklog()
    {
        var future=SettlementSchedule.Plan(100,3600,0,100,100);
        Assert.False(future.CanSettle); Assert.Equal(3600000,future.DelayMilliseconds);
        var notFinalized=SettlementSchedule.Plan(100,3600,0,3706,3700);
        Assert.False(notFinalized.CanSettle); Assert.Equal(5000,notFinalized.DelayMilliseconds);
        var recovered=SettlementSchedule.Plan(100,3600,10,100000,100000);
        Assert.True(recovered.CanSettle); Assert.Equal(10UL,recovered.CycleId);
        var afterPublication=SettlementSchedule.Plan(100,3600,11,100000,100000);
        Assert.True(afterPublication.CanSettle); Assert.Equal(11UL,afterPublication.CycleId);
    }
    private sealed class RpcHandler : HttpMessageHandler
    {
        public int Count;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
            Count++;
            var body=JsonSerializer.Deserialize<JsonElement>(await request.Content!.ReadAsStringAsync(ct));
            object result=body.GetProperty("method").GetString() switch { "getGenesisHash" => "genesis", "getSlot" => 100L, "getBlockTime" => 1000L, _ => throw new Exception() };
            return new(HttpStatusCode.OK) { Content=new StringContent(JsonSerializer.Serialize(new {result})) };
        }
    }
    [Fact]
    public async Task SharedTipCoalescesConcurrentOperationalReads()
    {
        var handler=new RpcHandler();
        var tip=new OperationalTip(new(".","http://test.invalid","program",1,null),new(),new HttpClient(handler));
        var results=await Task.WhenAll(Enumerable.Range(0,10).Select(_=>tip.Get(default)));
        Assert.Equal(3,handler.Count); Assert.All(results,r=>Assert.Equal(results[0],r));
    }
    private sealed class FakeHistory : HistoryReader
    {
        public HistoryBatch Batch = new("genesis","program","mint",1,100,100,[]);
        public readonly System.Collections.Concurrent.ConcurrentQueue<string> Reasons = new();
        public FakeHistory() : base(new(".","http://unused.invalid","program",1,null)) { }
        public override Task<HistoryBatch> Read(long checkpoint,CancellationToken ct,long? start=null,string reason="gap") { Reasons.Enqueue(reason); return Task.FromResult(Batch); }
    }
    [Fact]
    public async Task RunningIndexerRecoversMissedNotificationAndDeduplicatesOverlap()
    {
        var path=Path.Combine(Path.GetTempPath(),"yac-008-"+Guid.NewGuid()+".db");
        var services=new ServiceCollection();
        services.AddDbContext<AccountingDb>(o=>o.UseSqlite("Data Source="+path));
        services.AddLogging(); services.AddScoped<EventStore>();
        await using var provider=services.BuildServiceProvider();
        await using(var scope=provider.CreateAsyncScope()) await scope.ServiceProvider.GetRequiredService<AccountingDb>().Database.EnsureCreatedAsync();
        var history=new FakeHistory(); var health=new IndexerHealth(); var wakeup=new IndexerWakeup();
        using var worker=new Indexer(provider.GetRequiredService<IServiceScopeFactory>(),history,health,NullLogger<Indexer>.Instance,new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["YAC_INDEXER_GAP_MS"]="10000" }).Build(),wakeup);
        async Task WaitEvents(int count) {
            var until=DateTimeOffset.UtcNow.AddSeconds(15);
            while(DateTimeOffset.UtcNow<until) {
                await using var scope=provider.CreateAsyncScope();
                if(await scope.ServiceProvider.GetRequiredService<AccountingDb>().Events.CountAsync()==count) return;
                await Task.Delay(50);
            }
            throw new TimeoutException("Indexer failed to ingest finalized events");
        }
        ChainEvent Event(int slot,string type,string amount,string effective) => new() { Id=$"sig{slot}:0",Signature=$"sig{slot}",Slot=slot,BlockTime=slot,EventType=type,Amount=amount,EffectiveLockedAmount=effective,Wallet="wallet",Position="position",RawPayload=$"event{slot}" };
        try {
            await worker.StartAsync(default);
            var until=DateTimeOffset.UtcNow.AddSeconds(5);
            while(health.State.LastSuccess==null && DateTimeOffset.UtcNow<until) await Task.Delay(20);
            var created=Event(101,"positionCreated","0","0"); var deposited=Event(102,"deposited","1000000000","1000000000");
            history.Batch=new("genesis","program","mint",1,110,110,[created,deposited]);
            wakeup.Notify(); wakeup.Notify(); await WaitEvents(2);
            // Let any second notification already consumed by the worker finish before the disconnect.
            await Task.Delay(2500); await WaitEvents(2);
            // No notification while disconnected. Only the periodic gap can discover this withdrawal.
            wakeup.Connected=false;
            history.Batch=new("genesis","program","mint",1,120,120,[created,deposited,Event(115,"withdrawRequested","1000000000","0")]);
            await WaitEvents(3);
            await using var scope=provider.CreateAsyncScope(); var db=scope.ServiceProvider.GetRequiredService<AccountingDb>();
            var projection=await db.Projections.SingleAsync();
            Assert.Equal("0",projection.Locked); Assert.Equal("0",projection.Rate); Assert.Equal("13000",projection.Units);
            Assert.Contains("wakeup",history.Reasons); Assert.Contains("gap",history.Reasons);
            Assert.Equal(120,(await db.Checkpoints.SingleAsync()).ThroughSlot);
        }
        finally { await worker.StopAsync(default); SqliteConnection.ClearAllPools(); File.Delete(path); }
    }
}
