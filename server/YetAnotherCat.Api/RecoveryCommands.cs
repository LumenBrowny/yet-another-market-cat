using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;
public static class RecoveryCommands
{
    public static async Task Run(string command, string[] args, IServiceProvider services)
    {
        var cfg=services.GetRequiredService<IConfiguration>();
        if(cfg["YAC_PUBLISHER_ENABLED"]=="true") throw new InvalidOperationException("Disable automatic publisher before controlled recovery");
        var settings=services.GetRequiredService<BackendSettings>();
        var dir=Path.Combine(settings.Root,".dev");
        using var owner=new FileStream(Path.Combine(dir,"catchup.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
        var cycles=services.GetRequiredService<CycleService>();
        var db=services.GetRequiredService<AccountingDb>();
        var verifier=services.GetRequiredService<CycleVerification>();
        var safety=services.GetRequiredService<OperationalSafety>();
        var maximum=int.Parse(args.ElementAtOrDefault(Array.IndexOf(args,command)+1)??"1");
        if(maximum<1 || maximum>10000)throw new ArgumentException("Cycle limit must be 1..10000");
        string? current=null;
        async Task Record(bool active, string? error, object? evidence=null) {
            var json=JsonSerializer.Serialize(new {catchupActive=active,catchupCurrentCycle=current,catchupLastError=error,updatedAt=DateTimeOffset.UtcNow,evidence},HistoryReader.Json);
            var file=Path.Combine(dir,"catchup-status.json"); await File.WriteAllTextAsync(file+".tmp",json);File.Move(file+".tmp",file,true);
            Console.WriteLine("YAC_CATCHUP "+json);
        }
        try {
            for(var n=0;n<maximum;n++) {
                var watch=Stopwatch.StartNew();
                var state=await cycles.State();await cycles.Reconcile(state);
                var next=ulong.Parse(state.Config.NextCycle);
                var cp=await db.Checkpoints.AsNoTracking().SingleAsync();
                var plan=SettlementSchedule.Plan(long.Parse(state.Config.Genesis),long.Parse(state.Config.Duration),next,state.FinalizedTime??0,cp.ThroughTime);
                if(!plan.CanSettle)break;
                current=next.ToString(); await Record(true,null);
                var safe=await safety.Get(state.Config.Publisher,CancellationToken.None);
                if(safe.HistoryStatus=="critical"||safe.SolStatus!="healthy")throw new InvalidOperationException("History coverage or publisher SOL warning: recovery paused");
                await cycles.RequirePreviousVerified(next);
                if(command=="verify-pending") {
                    var row=await cycles.Build(next,state);
                    var report=await verifier.Verify(row,beforePublication:true,component:"catchup-verify");
                    RecoveryPolicy.RequireValid(report.GetProperty("result").GetString());
                    await Record(false,null,new {cycleId=next.ToString(),elapsedSeconds=watch.Elapsed.TotalSeconds,report});return;
                }
                var published=await cycles.Publish(next,state,cfg["YAC_PUBLISHER_KEY"]??throw new InvalidOperationException("Publisher key missing"));
                var after=await cycles.State();await cycles.Reconcile(after);
                if(ulong.Parse(after.Config.NextCycle)!=next+1)throw new InvalidOperationException("Unexpected next cycle after publication");
                CycleService.CheckPublished(published,after.Cycles.Single(c=>c.GetProperty("cycleId").GetString()==current));
                await Record(true,null,new {cycleId=current,elapsedSeconds=watch.Elapsed.TotalSeconds,signature=published.PublicationSignature,result="VALID",nextCycle=after.Config.NextCycle});
                await Task.Delay(TimeSpan.FromSeconds(RecoveryPolicy.DelaySeconds(cfg["YAC_CATCHUP_DELAY_SECONDS"])));
            }
            await Record(false,null);
        } catch(Exception ex) {await Record(false,ex is TimeoutException?ex.Message:ex.GetType().Name+": recovery stopped; inspect process log");throw;}
    }
}
