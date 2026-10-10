using System.Numerics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

public sealed class OperationsState
{
    public object? Snapshot { get; set; }
    public object Components { get; set; } = new { rpc="degraded",database="degraded",indexer="degraded",accounting="degraded",settlement="degraded",publisher="degraded",manifestStorage="degraded",rewardReserve="degraded" };
    public string Status { get; set; } = "degraded";
    public long UpdatedAt { get; set; }
}
public sealed class OperationsService(AccountingDb db, CycleService cycles, CycleVerification verifier, IManifestStorage storage, BackendSettings settings, IConfiguration config, IndexerHealth indexer, SettlementHealth settlement, OperationalSafety safety, IndexerWakeup wakeup, RpcMetrics metrics)
{
    public async Task<(object Snapshot, object Components, string Status)> Read(CancellationToken ct=default)
    {
        var chain=await cycles.State(ct);
        var safe = await safety.Get(chain.Config.Publisher, ct);
        var cycleProjection = await db.CycleProjectionCheckpoints.AsNoTracking().SingleOrDefaultAsync(ct);
        // A long independent publication replay must not make a freshly polled
        // finalized chain snapshot appear stale to read-only claim/proof clients.
        settlement.State=chain; settlement.UpdatedAt=DateTimeOffset.UtcNow;
        var cp=await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(ct);
        var rows=await db.Cycles.AsNoTracking().OrderBy(c=>c.StartTime).ToListAsync(ct);
        var miners=await db.Projections.AsNoTracking().ToListAsync(ct);
        var claims=await db.Events.AsNoTracking().Where(e=>e.EventType=="cycleClaimed").OrderByDescending(e=>e.Slot).ToListAsync(ct);
        var reports=await db.Verifications.AsNoTracking().ToListAsync(ct);
        var audits=new List<object>(); int missing=0,mismatch=0;
        foreach(var published in chain.Cycles) {
            var id=published.GetProperty("cycleId").GetString()!; var row=rows.FirstOrDefault(c=>c.CycleId==id);
            var auditStatus=row==null?"DB_MISSING":await verifier.Audit(row,published,ct);
            if(auditStatus=="MISSING"||auditStatus=="DB_MISSING") missing++; else if(auditStatus!="OK") mismatch++;
            audits.Add(new {cycleId=id,status=auditStatus});
        }
        var free=BigInteger.Parse(chain.VaultBalance)-BigInteger.Parse(chain.Config.CommittedUnclaimed);
        var remaining=free/BigInteger.Parse(chain.Config.Emission);
        var critical=int.TryParse(config["YAC_RESERVE_CRITICAL_CYCLES"],out var c)?c:20;
        var warning=int.TryParse(config["YAC_RESERVE_WARNING_CYCLES"],out var w)?w:100;
        var reserve=remaining<critical?"critical":remaining<warning?"degraded":"healthy";
        var storageStatus=missing+mismatch>0?"critical":"healthy";
        var invalid=reports.Count(r=>r.Status=="INVALID");
        var lag=cp==null?chain.LatestFinalizedSlot:Math.Max(0,chain.LatestFinalizedSlot-cp.ThroughSlot);
        var maxLag=int.TryParse(config["YAC_MAX_INDEXER_LAG_SLOTS"],out var configuredLag)?Math.Clamp(configuredLag,50,500):100;
        var current=chain.FinalizedTime==null?null:Settlement.CycleId(long.Parse(chain.Config.Genesis),long.Parse(chain.Config.Duration),chain.FinalizedTime.Value);
        var backlog=current==null?0:RecoveryPolicy.Backlog(current.Value,ulong.Parse(chain.Config.NextCycle));
        var status=storageStatus=="critical"||reserve=="critical"||invalid>0||safe.SolStatus=="critical"||safe.HistoryStatus=="critical"?"critical":backlog>0||!indexer.Healthy||!settlement.Healthy||lag>maxLag||reserve=="degraded"||!wakeup.Connected||safe.SolStatus=="degraded"||safe.HistoryStatus=="degraded"?"degraded":"healthy";
        var components=new {rpc="healthy",database="healthy",indexer=indexer.Healthy&&lag<=maxLag?"healthy":"degraded",accounting=cp!=null&&indexer.Healthy?"healthy":"degraded",settlement=invalid>0?"critical":settlement.Healthy?"healthy":"degraded",publisher=backlog==0&&settlement.Healthy?"healthy":"degraded",manifestStorage=storageStatus,rewardReserve=reserve,historyCoverage=safe.HistoryStatus,publisherSol=safe.SolStatus,ws=wakeup.Connected?"healthy":"degraded",cycleProjection=cycleProjection==null?"degraded":"healthy"};
        var claimed=claims.Aggregate(BigInteger.Zero,(s,e)=>s+BigInteger.Parse(e.Amount));
        var allocated=chain.Cycles.Aggregate(BigInteger.Zero,(s,e)=>s+BigInteger.Parse(e.GetProperty("totalAllocated").GetString()!));
        var chainClaimed=allocated-BigInteger.Parse(chain.Config.CommittedUnclaimed);
        var snapshot=new {
            status,components,updatedAt=DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            deployment=new { label="CANONICAL DEVNET 008", settings.ProgramId, cycleDuration=chain.Config.Duration, nextCycleBoundary=long.Parse(chain.Config.Genesis)+long.Parse(chain.Config.NextCycle)*long.Parse(chain.Config.Duration)+long.Parse(chain.Config.Duration) },
            historyCoverage=safe,
            recovery=RecoveryStatus.Read(settings),
            eventIndexing=new { wakeup.Connected, wakeup.LastNotification, wakeup.LastGapScan, gapScanSeconds=60 },
            cycleProjection=new { count=cycleProjection?.NextCycle, lastDiscoveredCycle=cycleProjection?.NextCycle-1, lastIntegrityAudit=cycleProjection?.AuditedAt, claimedAmounts="finalized event projection; periodic chain reconciliation" },
            rpcMetrics=metrics.Snapshot(),
            rpc=new { host=new Uri(settings.RpcUrl).Host,reachable=true,latestFinalizedSlot=chain.LatestFinalizedSlot,latestBlockTime=chain.FinalizedTime,latencyMs=chain.RpcLatencyMs,historyAvailability=indexer.Healthy?"available through checkpoint":"unavailable or catching up" },
            indexer=new {lastProcessedSlot=cp?.ThroughSlot,latestFinalizedSlot=chain.LatestFinalizedSlot,lagSlots=lag,blockTime=cp?.ThroughTime,eventsIngested=await db.Events.CountAsync(ct),lastError=indexer.State.Error},
            accounting=new {positions=miners.Count,activeMiners=miners.Count(m=>BigInteger.Parse(m.Rate)>0),watermark=cp?.ThroughTime,projectionRebuildStatus=indexer.Healthy?"current":"unknown",consistencyFailures=invalid},
            cycles=new { current=current?.ToString(),latestEnded=current>0?(current-1)?.ToString():null,latestCalculated=rows.LastOrDefault()?.CycleId,latestPublished=chain.Cycles.LastOrDefault().ValueKind==JsonValueKind.Undefined?null:chain.Cycles.Last().GetProperty("cycleId").GetString(),oldestUnpublishedEnded=current>ulong.Parse(chain.Config.NextCycle)?chain.Config.NextCycle:null,backlogCount=current==null?0:RecoveryPolicy.Backlog(current.Value,ulong.Parse(chain.Config.NextCycle)),failedCycles=reports.Where(r=>r.Status=="INVALID").Select(r=>r.CycleId)},
            publisher=new {configured=!string.IsNullOrEmpty(config["YAC_PUBLISHER_KEY"]),enabled=config["YAC_PUBLISHER_ENABLED"]=="true",publicKey=chain.Config.Publisher,lastPublication=rows.LastOrDefault(r=>r.Status=="PUBLISHED")?.PublicationSignature,lastError=settlement.Error},
            reserve=new {vaultBaseUnits=chain.VaultBalance,committedBaseUnits=chain.Config.CommittedUnclaimed,availableBaseUnits=free.ToString(),claimedBaseUnits=claimed.ToString(),cyclesRemaining=remaining.ToString(),status=reserve},
            faucet=new {initialBaseUnits="1000000000000",claimedBaseUnits=chain.FaucetDistributed,remainingBaseUnits=chain.FaucetDistributed==null?null:(1000000000000-BigInteger.Parse(chain.FaucetDistributed)).ToString(),estimatedWalletsRemaining=chain.FaucetDistributed==null?null:((1000000000000-BigInteger.Parse(chain.FaucetDistributed))/2000000000).ToString(),automaticRefill=false},
            manifests=new {provider=storage.Provider,published=chain.Cycles.Length,present=chain.Cycles.Length-missing,missing,hashMismatches=mismatch,audits},
            claims=new {count=claims.Count,claimedBaseUnits=claimed.ToString(),chainClaimedBaseUnits=chainClaimed.ToString(),reconciliation=chainClaimed==claimed?"MATCH":"AWAITING_FINALIZED_RECONCILIATION",consistency="RewardConfig and event checkpoint are sampled separately; a temporary difference must converge after finalized backfill",recent=claims.Take(15).Select(e=>new {e.CycleId,e.Wallet,e.Amount,e.Signature,e.BlockTime}),rejectedObservations="Preflight rejections are not finalized claims"},
            trust=new {upgradeAuthority=chain.UpgradeAuthority,upgradeAuthorityStatus=chain.UpgradeAuthority==null?"NONE":"ACTIVE",publisherModel="CENTRALIZED",rootChallengeMechanism="NONE"},
            events=await db.OperatorEvents.AsNoTracking().OrderByDescending(e=>e.Timestamp).Take(50).ToArrayAsync(ct)
        };
        return(snapshot,components,status);
    }
}
public sealed class OperationsMonitor(IServiceScopeFactory scopes,OperationsState state,ILogger<OperationsMonitor> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while(!stoppingToken.IsCancellationRequested) {
            try {
                await using var scope=scopes.CreateAsyncScope();
                var service=scope.ServiceProvider.GetRequiredService<OperationsService>();
                var result=await service.Read(stoppingToken);
                state.Snapshot=result.Snapshot; state.Components=result.Components; state.Status=result.Status; state.UpdatedAt=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                logger.LogInformation("YAC_RPC_SUMMARY {Summary}", JsonSerializer.Serialize(scope.ServiceProvider.GetRequiredService<RpcMetrics>().Snapshot()));
                var db=scope.ServiceProvider.GetRequiredService<AccountingDb>();
                if(result.Status!="healthy") { logger.LogWarning("Operational status {Status}; inspect protected dashboard",result.Status); db.OperatorEvents.Add(new(){Kind="health",Severity=result.Status=="critical"?"CRITICAL":"WARNING",Message=result.Status}); await db.SaveChangesAsync(stoppingToken); }
                var cutoff=DateTimeOffset.UtcNow.AddDays(-7).ToUnixTimeSeconds();
                await db.OperatorEvents.Where(e=>e.Timestamp<cutoff).ExecuteDeleteAsync(stoppingToken);
            } catch(OperationCanceledException) when(stoppingToken.IsCancellationRequested) {break;}
            catch(Exception ex) { state.Status=ex.Message.Contains("CRITICAL:")?"critical":"degraded"; state.UpdatedAt=DateTimeOffset.UtcNow.ToUnixTimeSeconds(); state.Components=new {checks=state.Status,detail="Operational integrity check failed; inspect logs"}; logger.LogWarning("Operational checks unavailable ({Type}): {Stack}",ex.GetType().Name,ex.StackTrace); }
            try { await Task.Delay(30_000,stoppingToken); } catch(OperationCanceledException) {break;}
        }
    }
}

// Replaying history must not block health polling or make published proof reads
// intermittently unavailable. Publication performs its own immediate verification;
// this worker recovers reports after interruption, once reconciliation found a slot.
public sealed class VerificationWorker(IServiceScopeFactory scopes,ILogger<VerificationWorker> logger):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var failures = 0;
        while(!stoppingToken.IsCancellationRequested) {
            try {
                await using var scope=scopes.CreateAsyncScope();
                var db=scope.ServiceProvider.GetRequiredService<AccountingDb>();
                var retryBefore=DateTimeOffset.UtcNow.AddMinutes(-5).ToUnixTimeSeconds();
                var next=await db.Cycles.Where(c=>c.Status=="PUBLISHED"&&c.PublishedSlot>0&&(!db.Verifications.Any(v=>v.CycleId==c.CycleId)||db.Verifications.Any(v=>v.CycleId==c.CycleId&&v.Status=="UNVERIFIABLE"&&v.VerifiedAt<retryBefore))).OrderByDescending(c=>c.StartTime).FirstOrDefaultAsync(stoppingToken);
                if(next!=null) await scope.ServiceProvider.GetRequiredService<CycleVerification>().Verify(next,ct:stoppingToken,component:"recovery");
                failures = 0;
            } catch(OperationCanceledException) when(stoppingToken.IsCancellationRequested) {break;}
            catch(Exception ex) {failures = Math.Min(failures + 1, 4); logger.LogWarning("Background verification deferred ({Type}); backoff level {Level}",ex.GetType().Name, failures);}
            try {await Task.Delay(Math.Min(300_000, 30_000 * (1 << failures)),stoppingToken);} catch(OperationCanceledException) {break;}
        }
    }
}
