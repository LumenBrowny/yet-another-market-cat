using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;
public static class ProductCommands
{
    public static readonly string[] Names=["catch-up-cycles","verify-pending","verify-cycle","audit-manifest-storage","regenerate-manifest","upload-existing-manifests","status","initialize-storage"];
    public static async Task Run(string command,string[] args,IServiceProvider services)
    {
        if(command is "catch-up-cycles" or "verify-pending") {await RecoveryCommands.Run(command,args,services);return;}
        if(command=="initialize-storage") {if(services.GetRequiredService<IManifestStorage>() is S3ManifestStorage s3)await s3.InitializeBucket();return;}
        var cycles=services.GetRequiredService<CycleService>(); var db=services.GetRequiredService<AccountingDb>(); var verification=services.GetRequiredService<CycleVerification>();
        var state=await cycles.State(); await cycles.Reconcile(state);
        if(command=="status") { Console.WriteLine(JsonSerializer.Serialize(state,HistoryReader.Json));return; }
        if(command=="audit-manifest-storage") {
            var failed=false;
            foreach(var chain in state.Cycles) {
                var id=chain.GetProperty("cycleId").GetString()!;var row=await db.Cycles.SingleAsync(c=>c.CycleId==id);
                var status=await verification.Audit(row,chain); Console.WriteLine(JsonSerializer.Serialize(new{cycleId=id,status}));if(status!="OK")failed=true;
            }
            if(failed)Environment.ExitCode=2;return;
        }
        if(command=="upload-existing-manifests") {
            var rows=await db.Cycles.Where(c=>c.Status=="PUBLISHED").OrderBy(c=>c.StartTime).ToArrayAsync();
            var reports=await services.GetRequiredService<SettlementBridge>().Call("verify-batch",canonical:JsonSerializer.Serialize(rows.Select(r=>r.ManifestJson)));
            if(reports.GetArrayLength()!=rows.Length)throw new InvalidOperationException("Incomplete batch verification reports");
            foreach(var pair in rows.Zip(reports.EnumerateArray())) {
                CycleService.CheckPublished(pair.First,state.Cycles.Single(c=>c.GetProperty("cycleId").GetString()==pair.First.CycleId));
                await verification.StoreReport(pair.First,pair.Second);
                Console.WriteLine(pair.Second.GetRawText());
                if(pair.Second.GetProperty("result").GetString()!="VALID") {Environment.ExitCode=2;continue;}
                await verification.Persist(pair.First);
            }
            return;
        }
        var selected=command=="upload-existing-manifests"?state.Cycles.Select(c=>c.GetProperty("cycleId").GetString()!).ToArray():[args.ElementAtOrDefault(Array.IndexOf(args,command)+1)??throw new ArgumentException("Cycle ID required")];
        foreach(var id in selected) {
            if(!ProductApi.ValidId(id))throw new ArgumentException("Invalid canonical cycle ID");
            var row=await cycles.Build(ulong.Parse(id),state,persist:false);
            var chain=state.Cycles.Single(c=>c.GetProperty("cycleId").GetString()==id);CycleService.CheckPublished(row,chain);
            var report=await verification.Verify(row,component:"operator");
            Console.WriteLine(report.GetRawText());
            if(report.GetProperty("result").GetString()!="VALID") {Environment.ExitCode=2;continue;}
            if(command!="verify-cycle")await verification.Persist(row);
        }
    }
}
