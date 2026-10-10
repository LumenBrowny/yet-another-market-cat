using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using YetAnotherCat.Infrastructure;
using Xunit;

namespace YetAnotherCat.Tests;

public sealed class PostgresRelaunchTests
{
    public sealed class PostgresFactAttribute : FactAttribute
    {
        public PostgresFactAttribute() { if(string.IsNullOrEmpty(Environment.GetEnvironmentVariable("YAC_TEST_POSTGRES"))) Skip="Requires isolated PostgreSQL via YAC_TEST_POSTGRES"; }
    }
    [PostgresFact]
    public async Task IsolatedPostgresMigrationPersistenceAndProjectionRecovery()
    {
        var connection=Environment.GetEnvironmentVariable("YAC_TEST_POSTGRES");
        if(string.IsNullOrEmpty(connection)) return; // Explicitly enabled integration fixture, reported separately.
        var builder=new NpgsqlConnectionStringBuilder(connection);
        if(builder.Database!="yac_tests_008") throw new InvalidOperationException("Only isolated yac_tests_008 is allowed");
        var options=new DbContextOptionsBuilder<AccountingDb>().UseNpgsql(connection).Options;
        await using(var db=new AccountingDb(options)) {
            await db.Database.MigrateAsync();
            var store=new EventStore(db,NullLogger<EventStore>.Instance);
            ChainEvent Event(int slot,string type,string amount,string locked)=>new(){Id=$"pg{slot}:0",Signature=$"pg{slot}",Slot=slot,BlockTime=slot,EventType=type,Amount=amount,EffectiveLockedAmount=locked,Wallet="pg-wallet",Position="pg-position",RawPayload="pg"+slot};
            var batch=new HistoryBatch("pg-genesis","pg-program","pg-mint",1,120,120,[Event(100,"positionCreated","0","0"),Event(101,"deposited","1000000000","1000000000")]);
            await store.Ingest(batch); Assert.Equal(0,await store.Ingest(batch));
            var state=JsonSerializer.SerializeToElement(new {programId="pg-program",genesisHash="pg-genesis",config=new {tokenMint="pg-mint",nextCycle="2"}});
            await CycleProjectionStore.Merge(db,state,(_,from,to)=>Task.FromResult(JsonSerializer.SerializeToElement(Enumerable.Range((int)from,(int)(to-from)).Select(i=>new {cycleId=i.ToString(),claimedAmount="0",root="pg-root"}))),default);
        }
        await using(var db=new AccountingDb(options)) {
            Assert.Equal(2,await db.Events.CountAsync());
            Assert.Equal("1000000000",(await db.Projections.SingleAsync()).Locked);
            Assert.Equal(2,(await db.CycleProjectionCheckpoints.SingleAsync()).NextCycle);
            var state=JsonSerializer.SerializeToElement(new {programId="pg-program",genesisHash="pg-genesis",config=new {tokenMint="pg-mint",nextCycle="2"}});
            await CycleProjectionStore.Merge(db,state,(_,_,_)=>throw new Exception("Restart must not re-fetch history"),default);
        }
        var reads=0;
        var downloads=0;
        async Task Refresh() {
            await using var db=new AccountingDb(options);
            await CycleProjectionStore.Refresh(db,async()=> {
                Interlocked.Increment(ref reads);
                await Task.Delay(150);
                return JsonSerializer.SerializeToElement(new {programId="pg-program",genesisHash="pg-genesis",config=new {tokenMint="pg-mint",nextCycle="3"}});
            },(_,from,to)=> {
                Interlocked.Increment(ref downloads);
                return Task.FromResult(JsonSerializer.SerializeToElement(Enumerable.Range((int)from,(int)(to-from)).Select(i=>new {cycleId=i.ToString(),claimedAmount="0",root="pg-root"})));
            },default);
        }
        await Task.WhenAll(Refresh(),Refresh());
        Assert.Equal(2,reads);
        Assert.Equal(1,downloads);
        await using(var db=new AccountingDb(options)) {
            Assert.Equal(3,await db.PublishedCycleProjections.CountAsync());
            Assert.Equal(3,(await db.CycleProjectionCheckpoints.SingleAsync()).NextCycle);
        }
    }
}
