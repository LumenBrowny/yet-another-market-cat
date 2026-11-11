using System.Numerics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Tests;

public sealed class AccountingTests
{
    public static IEnumerable<object[]> Fixtures() => JsonDocument.Parse(File.ReadAllText("accounting-fixtures.json")).RootElement.EnumerateArray().Select(f => new object[] { f.Clone() });
    [Theory, MemberData(nameof(Fixtures))]
    public void SharedFixtures(JsonElement fixture)
    {
        var transitions = fixture.GetProperty("transitions").EnumerateArray().Select((e, i) => new Transition(e.GetProperty("time").GetInt64(), Points.Integer(e.GetProperty("locked").GetString()!), i + 1, 0, 0));
        Assert.Equal(fixture.GetProperty("expected").GetString(), Points.CalculatePoints(transitions, fixture.GetProperty("start").GetInt64(), fixture.GetProperty("end").GetInt64()).ToString());
    }
    [Fact] public void LongDurationDoesNotOverflow() => Assert.Equal((BigInteger)long.MaxValue * 25000, Points.CalculatePoints([new(0, 500_000_000_000, 1, 0, 0)], 0, long.MaxValue));
    [Fact]
    public async Task LaunchHorizonFreezesLifetimeDespitePublicationDelayAndWithdrawals()
    {
        await using var db = await Open(TemporaryDatabase());
        var clock = new CurrentCycleClock { Configuration = new("mint", "publisher", "100", "100", "250000000000", "0", "0", true, "100", "0", "98750000000000") };
        var snapshots = new Snapshots(db, clock);
        async Task<JsonElement> Read() => JsonSerializer.SerializeToElement(await snapshots.Miner("wallet", true, 10));
        await Store(db).Ingest(Batch(3, 500, Event(1, 100, "positionCreated"), Event(2, 100, "deposited", "1000000000", "1000000000"), Event(3, 400, "withdrawRequested", "1000000000", "0")));
        var pending = await Read();
        Assert.Equal("100000", pending.GetProperty("pointUnits").GetString());
        Assert.Equal("FINALIZING", pending.GetProperty("distributionStatus").GetString());
        Assert.Equal(200, pending.GetProperty("ppAccrualEnd").GetInt64());
        clock.Configuration = clock.Configuration with { NextCycle="1", PpCutoff="200", TotalAllocated="99000000000000" };
        var final = await Read();
        Assert.Equal("100000", final.GetProperty("pointUnits").GetString());
        Assert.Equal("0", final.GetProperty("ratePointUnitsPerSecond").GetString());
        Assert.True(final.GetProperty("pointsFinal").GetBoolean());
        Assert.Equal(JsonValueKind.Null, final.GetProperty("currentCycleId").ValueKind);
        await Store(db).Ingest(Batch(4, 90000, Event(4, 90000, "withdrawExecuted", "1000000000", "0")));
        Assert.Equal("100000", (await Read()).GetProperty("pointUnits").GetString());
        clock.Configuration = clock.Configuration with { ActivatedAt="0", Genesis="0", PpCutoff="0", NextCycle="0" };
        Assert.Equal("0", (await Read()).GetProperty("pointUnits").GetString());
    }
    [Fact]
    public async Task PrelockHasNoPointsUntilScheduledMiningGenesis()
    {
        await using var db = await Open(TemporaryDatabase());
        var clock = new CurrentCycleClock { Configuration = new("mint", "publisher", "300", "86400", "250000000000", "0", "0", true, "300", "0", "0", "100", "200") };
        var snapshots = new Snapshots(db, clock);
        await Store(db).Ingest(Batch(2, 150, Event(1, 100, "positionCreated"), Event(2, 100, "deposited", "1000000000", "1000000000")));
        var before = JsonSerializer.SerializeToElement(await snapshots.Miner("wallet", true, 2));
        Assert.Equal("0", before.GetProperty("pointUnits").GetString());
        Assert.Equal("0", before.GetProperty("ratePointUnitsPerSecond").GetString());
        Assert.Equal("PREPARED", before.GetProperty("distributionStatus").GetString());
        await Store(db).Ingest(Batch(3, 310));
        var after = JsonSerializer.SerializeToElement(await snapshots.Miner("wallet", true, 3));
        Assert.Equal("10000", after.GetProperty("pointUnits").GetString());
        Assert.Equal("ACTIVE", after.GetProperty("distributionStatus").GetString());
    }
    [Fact]
    public void LifecycleRejectsNewCyclesButPreservesHistoricalReconstruction()
    {
        var r = new RewardConfiguration("mint","publisher","100","100","250000000000","1","397",true,"100","39800","99000000000000");
        RewardLifecycle.RequireBuild(r,396);
        Assert.Throws<InvalidOperationException>(()=>RewardLifecycle.RequireBuild(r,397));
        Assert.Throws<InvalidOperationException>(()=>RewardLifecycle.RequireBuild(r with { ActivatedAt="0" },0));
        Assert.Equal(39800, RewardLifecycle.Horizon(r));
        var active=r with { PpCutoff="0", NextCycle="0", TotalAllocated="0" };
        Assert.Equal(39700,RewardLifecycle.Horizon(active));
        Assert.Equal(39800,RewardLifecycle.Horizon(active with { NextCycle="1" })); // empty cycle
        Assert.Equal(39700,RewardLifecycle.Horizon(active with { NextCycle="1", TotalAllocated="250000000000" }));
    }
    [Fact]
    public void InvalidRangesRejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Points.CalculatePoints([], 10, 9));
        Assert.Throws<ArgumentOutOfRangeException>(() => Points.TierFor(-1));
        Assert.Throws<ArgumentOutOfRangeException>(() => Points.TierFor((BigInteger)ulong.MaxValue + 1));
    }
    [Fact]
    public void OrderIsChainOrderNotEnumerationOrder()
    {
        Transition[] transitions = [new(0, 1000000000, 2, 0, 0), new(0, 5000000000, 2, 1, 0), new(0, 2500000000, 2, 1, 1)];
        Assert.Equal(15000, Points.CalculatePoints(transitions.Reverse(), 0, 10));
    }
    [Fact]
    public void EveryTierBoundaryMatchesSpec()
    {
        foreach (var tier in Points.Tiers)
        {
            Assert.Equal(tier, Points.TierFor(Points.Integer(tier.MinimumBaseUnits)));
            if (tier.Id != "DEAD_INSIDE") Assert.NotEqual(tier, Points.TierFor(Points.Integer(tier.MinimumBaseUnits) - 1));
        }
    }

    private static ChainEvent Event(long slot, long time, string type, string amount = "0", string locked = "0") => new() { Id = $"sig{slot}:0", Signature = $"sig{slot}", Slot = slot, BlockTime = time, EventType = type, Amount = amount, EffectiveLockedAmount = locked, Wallet = "wallet", Position = "position", RawPayload = $"raw{slot}" };
    private static HistoryBatch Batch(long slot, long time, params ChainEvent[] events) => new("genesis", "program", "mint", 1, slot, time, events);
    private static EventStore Store(AccountingDb db) => new(db, NullLogger<EventStore>.Instance);
    private static async Task<AccountingDb> Open(string connection)
    {
        var db = new AccountingDb(new DbContextOptionsBuilder<AccountingDb>().UseSqlite(connection).Options);
        await db.Database.MigrateAsync();
        return db;
    }
    private static string TemporaryDatabase() => $"Data Source={Path.Combine(Path.GetTempPath(), $"yac-tests-{Guid.NewGuid()}.db")}";
    [Fact]
    public async Task HourBoundaryResetsOnlyCurrentPointsAndRespectsStakeTransitions()
    {
        await using var db = await Open(TemporaryDatabase());
        var clock = new CurrentCycleClock { Configuration = new("mint", "publisher", "100", "3600", "100000000000", "0", "0") };
        var snapshots = new Snapshots(db, clock);
        async Task<JsonElement> Read(long slot) => JsonSerializer.SerializeToElement(await snapshots.Miner("wallet", true, slot));
        await Store(db).Ingest(Batch(3, 3699, Event(1, 100, "positionCreated"), Event(2, 100, "deposited", "1000000000", "1000000000"), Event(3, 3690, "deposited", "2000000000", "3000000000")));
        var before = await Read(3);
        Assert.Equal("0", before.GetProperty("currentCycleId").GetString());
        Assert.Equal("3603500", before.GetProperty("pointUnits").GetString());
        Assert.Equal("3603500", before.GetProperty("currentCyclePointUnits").GetString());
        await Store(db).Ingest(Batch(4, 3700));
        var boundary = await Read(4);
        Assert.Equal("1", boundary.GetProperty("currentCycleId").GetString());
        Assert.Equal("3605000", boundary.GetProperty("pointUnits").GetString());
        Assert.Equal("0", boundary.GetProperty("currentCyclePointUnits").GetString());
        await Store(db).Ingest(Batch(6, 3710, Event(5, 3705, "withdrawRequested", "3000000000", "0")));
        var after = await Read(6);
        Assert.Equal("3612500", after.GetProperty("pointUnits").GetString());
        Assert.Equal("7500", after.GetProperty("currentCyclePointUnits").GetString());
        Assert.Equal("0", after.GetProperty("ratePointUnitsPerSecond").GetString());
    }
    [Fact]
    public async Task WithdrawalExecuteDoesNotDoubleReduceAndRebuildIsExact()
    {
        await using var db = await Open(TemporaryDatabase());
        var events = new[] { Event(1, 0, "positionCreated"), Event(2, 10, "deposited", "50000000000", "50000000000"), Event(3, 110, "withdrawRequested", "49000000000", "1000000000"), Event(4, 86510, "withdrawExecuted", "49000000000", "1000000000") };
        await Store(db).Ingest(Batch(4, 86610, events));
        var before = JsonSerializer.Serialize(await new Snapshots(db).Miner("wallet", true, 4));
        Assert.Contains("\"poopPoints\":\"87300\"", before);
        Assert.Equal("1000", (await db.Projections.SingleAsync()).Rate);
        await Store(db).Rebuild();
        Assert.Equal(before, JsonSerializer.Serialize(await new Snapshots(db).Miner("wallet", true, 4)));
    }
    [Fact]
    public async Task OverlapAndTwoReadersCannotDoubleMine()
    {
        await using var db = await Open(TemporaryDatabase());
        var create = Event(1, 0, "positionCreated");
        var deposit = Event(2, 0, "deposited", "1000000000", "1000000000");
        await Store(db).Ingest(Batch(2, 100, create, deposit));
        await Store(db).Ingest(Batch(3, 200, create, deposit));
        Assert.Equal(2, await db.Events.CountAsync());
        var snapshots = new Snapshots(db);
        var first = JsonSerializer.Serialize(await snapshots.Miner("wallet", true, 3));
        Assert.Equal(first, JsonSerializer.Serialize(await snapshots.Miner("wallet", true, 3)));
        Assert.Contains("\"poopPoints\":\"200\"", first);
        Assert.Equal("0", (await db.Projections.SingleAsync()).Units);
    }
    [Fact]
    public async Task PersistDisposeRestartCatchesUpWithoutTimers()
    {
        var path = TemporaryDatabase();
        await using (var db = await Open(path)) await Store(db).Ingest(Batch(2, 100, Event(1, 0, "positionCreated"), Event(2, 0, "deposited", "2500000000", "2500000000")));
        await using (var db = await Open(path))
        {
            await Store(db).Ingest(Batch(10, 200));
            Assert.Contains("\"poopPoints\":\"300\"", JsonSerializer.Serialize(await new Snapshots(db).Miner("wallet", true, 10)));
        }
    }
    [Fact]
    public async Task FailureRollsBackSourceProjectionAndCheckpoint()
    {
        var path = TemporaryDatabase();
        await using (var db = await Open(path))
        {
            await Store(db).Ingest(Batch(1, 0, Event(1, 0, "positionCreated")));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Store(db).Ingest(Batch(3, 100, Event(2, 10, "deposited", "1000000000", "1000000000"), Event(3, 20, "deposited", "1", "7"))));
        }
        await using (var db = await Open(path))
        {
            Assert.Equal(1, await db.Events.CountAsync());
            Assert.Equal(1, (await db.Checkpoints.SingleAsync()).ThroughSlot);
            Assert.Equal("0", (await db.Projections.SingleAsync()).Locked);
            await Store(db).Ingest(Batch(2, 10, Event(2, 10, "deposited", "1000000000", "1000000000")));
            Assert.Equal(2, await db.Events.CountAsync());
        }
    }
    [Fact]
    public async Task ConflictingDuplicateAndMixedChainRejected()
    {
        await using var db = await Open(TemporaryDatabase());
        await Store(db).Ingest(Batch(1, 0, Event(1, 0, "positionCreated")));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store(db).Ingest(Batch(2, 10, Event(1, 1, "positionCreated"))));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store(db).Ingest(Batch(2, 10) with { GenesisHash = "other" }));
    }
    [Fact]
    public async Task MissingCreationAndLateUnseenEventRejected()
    {
        await using var db = await Open(TemporaryDatabase());
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store(db).Ingest(Batch(2, 10, Event(2, 10, "deposited", "1000000000", "1000000000"))));
        db.ChangeTracker.Clear();
        await Store(db).Ingest(Batch(3, 10, Event(1, 0, "positionCreated")));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Store(db).Ingest(Batch(4, 20, Event(2, 10, "deposited", "1000000000", "1000000000"))));
    }
    [Theory]
    [InlineData("rewardsActivated")]
    [InlineData("publisherRotated")]
    [InlineData("faucetIssuerRotated")]
    public async Task AdministrativeEventIsRecordedWithoutCreatingMinerAndSurvivesRebuild(string eventType)
    {
        await using var db = await Open(TemporaryDatabase());
        await Store(db).Ingest(Batch(1, 100, Event(1, 100, eventType)));
        Assert.Empty(await db.Projections.ToListAsync());
        Assert.Equal(eventType, (await db.Events.SingleAsync()).EventType);
        Assert.Equal(1, (await db.Checkpoints.SingleAsync()).ThroughSlot);
        await Store(db).Ingest(Batch(3, 150, Event(2, 120, "positionCreated"), Event(3, 150, "deposited", "1000000000", "1000000000")));
        await Store(db).Rebuild();
        Assert.Single(await db.Projections.ToListAsync());
        Assert.Equal(3, await db.Events.CountAsync());
    }
    [Fact]
    public async Task FaucetDoesNotMineAndSourceIsAppendOnly()
    {
        await using var db = await Open(TemporaryDatabase());
        await Store(db).Ingest(Batch(1, 100, Event(1, 0, "faucetClaimed", "2000000000")));
        Assert.Empty(await db.Projections.ToListAsync());
        var e = await db.Events.SingleAsync();
        e.Amount = "1";
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
    }
}
