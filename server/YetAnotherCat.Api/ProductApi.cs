using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;
public static class ProductApi
{
    public static bool ValidId(string id)=>ulong.TryParse(id,out var n)&&n.ToString()==id;
    public static bool ValidWallet(string wallet) { try { _=Settlement.PublicKey(wallet); return true; } catch(ArgumentException) { return false; } }
    public static bool Authorized(string supplied,string? configured) => configured?.Length>=32 && supplied.StartsWith("Bearer ",StringComparison.Ordinal) && CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(supplied[7..])),SHA256.HashData(Encoding.UTF8.GetBytes(configured)));
    public static void AddProduct(this WebApplicationBuilder builder, string root)
    {
        var config=builder.Configuration;
        var publicBase=config["YAC_MANIFEST_PUBLIC_BASE_URL"]??config["YAC_S3_PUBLIC_BASE_URL"];
        if(publicBase!=null && (!Uri.TryCreate(publicBase,UriKind.Absolute,out var publicUri)||publicUri.Scheme is not ("http" or "https")||publicUri.UserInfo!=""||publicUri.Query!=""||publicUri.Fragment!=""))throw new InvalidOperationException("Public manifest base must be an HTTP(S) URL without credentials, query or fragment");
        config["YAC_MANIFEST_PUBLIC_BASE_URL"]=publicBase?.TrimEnd('/');
        builder.Services.AddSingleton<IManifestStorage>(_=> {
            if(config["YAC_MANIFEST_PROVIDER"] is null or "local") return new LocalManifestStorage(config["YAC_MANIFEST_ROOT"]??Path.Combine(root,"artifacts","manifests"));
            if(config["YAC_MANIFEST_PROVIDER"]!="s3") throw new InvalidOperationException("Unknown storage provider");
            var endpoint=config["YAC_S3_ENDPOINT"]??throw new InvalidOperationException("S3 endpoint required");
            var client=new AmazonS3Client(new BasicAWSCredentials(config["YAC_S3_ACCESS_KEY"]??throw new InvalidOperationException("S3 access key required"),config["YAC_S3_SECRET_KEY"]??throw new InvalidOperationException("S3 secret required")),new AmazonS3Config { ServiceURL=endpoint,ForcePathStyle=true,AuthenticationRegion=config["YAC_S3_REGION"]??"us-east-1" });
            return new S3ManifestStorage(client,config["YAC_S3_BUCKET"]??throw new InvalidOperationException("S3 bucket required"),config["YAC_MANIFEST_PREFIX"]??"");
        });
        builder.Services.AddScoped<CycleVerification>(); builder.Services.AddScoped<OperationsService>(); builder.Services.AddSingleton<OperationsState>();
        builder.Services.AddRateLimiter(options=> {
            options.RejectionStatusCode=429;
            options.GlobalLimiter=PartitionedRateLimiter.Create<HttpContext,string>(ctx=> {
                var path=ctx.Request.Path.Value??"";
                var category=path.StartsWith("/api/operator",StringComparison.Ordinal)?"operator":path.Contains("proof",StringComparison.Ordinal)||path.Contains("verify-wallet",StringComparison.Ordinal)?"proof":"read";
                return RateLimitPartition.GetFixedWindowLimiter((ctx.Connection.RemoteIpAddress?.ToString()??"unknown")+":"+category,_=>new FixedWindowRateLimiterOptions { PermitLimit=category=="operator"?300:category=="proof"?600:3000,Window=TimeSpan.FromMinutes(1),QueueLimit=0 });
            });
            options.OnRejected=(context,_)=> {context.HttpContext.Response.Headers.RetryAfter="60";return ValueTask.CompletedTask;};
            options.AddConcurrencyLimiter("verification",o=> {o.PermitLimit=1;o.QueueLimit=0;});
        });
    }
    public static void UseProductSecurity(this WebApplication app)
    {
        app.UseRateLimiter();
        app.Use(async(ctx,next)=> {
            ctx.Response.Headers["X-Content-Type-Options"]="nosniff";
            ctx.Response.Headers["Referrer-Policy"]="no-referrer";
            ctx.Response.Headers["Content-Security-Policy"]="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
            ctx.Response.Headers.CacheControl="no-store";
            if(ctx.Request.Path.StartsWithSegments("/api/operator") && !Authorized(ctx.Request.Headers.Authorization.ToString(),app.Configuration["YAC_ADMIN_TOKEN"])) {ctx.Response.StatusCode=401; await ctx.Response.WriteAsJsonAsync(new {error="Operator bearer token required"});return;}
            try { await next(); }
            catch(OperationCanceledException) when(ctx.RequestAborted.IsCancellationRequested) { }
            catch(Exception ex) { app.Logger.LogWarning("Request failed: {Type}",ex.GetType().Name); if(!ctx.Response.HasStarted) {ctx.Response.StatusCode=503;await ctx.Response.WriteAsJsonAsync(new {error="Service unavailable; retry later"});} }
        });
        app.UseStaticFiles();
    }
    public static async Task<IResult> Download(string id,string? genesis,AccountingDb db,IManifestStorage storage,HttpContext context,CancellationToken ct)
    {
        if(!ValidId(id)||(genesis!=null&&!ValidWallet(genesis))) return Results.BadRequest(new {error="Invalid cycle identity"});
        var row=await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c=>c.CycleId==id&&c.Status=="PUBLISHED",ct); if(row==null)return Results.NotFound();
        var m=CycleService.Manifest(row); if(genesis!=null&&genesis!=m.GenesisHash) return Results.NotFound();
        var bytes=await storage.Get(m.GenesisHash,id,ct); if(bytes==null)return Results.Json(new {error="Committed manifest unavailable"},statusCode:503);
        try { ManifestIdentity.Verify(bytes,row.ManifestHash); } catch(InvalidDataException) {return Results.Json(new {error="Manifest hash mismatch"},statusCode:503);}
        var etag='"'+row.ManifestHash+'"'; context.Response.Headers.ETag=etag;
        context.Response.Headers.CacheControl=genesis==null?"no-cache":"public, max-age=31536000, immutable";
        if(context.Request.Headers.IfNoneMatch==etag)return Results.StatusCode(304);
        return Results.File(bytes,"application/json",fileDownloadName:$"cycle-{id}-manifest.json");
    }
    public static async Task<IResult> CachedVerification(string id,AccountingDb db,IManifestStorage storage,CancellationToken ct)
    {
        if(!ValidId(id))return Results.BadRequest();
        var cycle=await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c=>c.CycleId==id,ct); if(cycle==null)return Results.NotFound();
        var record=await db.Verifications.AsNoTracking().SingleOrDefaultAsync(v=>v.CycleId==id,ct);
        var bytes=await storage.Get(CycleService.Manifest(cycle).GenesisHash,id,ct);
        if(bytes==null)return Results.Ok(new {cycleId=id,result="UNVERIFIABLE",checks=new[]{new{id="manifest",label="Manifest availability",status="UNAVAILABLE",detail="Manifest object missing; this does not prove invalidity"}}});
        if(Settlement.Hash(bytes)!=cycle.ManifestHash)return Results.Ok(new {cycleId=id,result="INVALID",checks=new[]{new{id="manifestHash",label="Manifest SHA-256",status="FAIL",detail="Stored manifest hash mismatch"}}});
        if(record==null||record.ManifestHash!=cycle.ManifestHash||record.Root!=cycle.Root)return Results.Ok(new {cycleId=id,result="UNVERIFIABLE",checks=Array.Empty<object>(),detail="No matching chain verification report yet. Operator may run verify-cycle."});
        return Results.Text(record.ReportJson,"application/json");
    }
    public static async Task<object> Summary(CycleRecord row,string? wallet,AccountingDb db,CancellationToken ct)
    {
        var m=CycleService.Manifest(row); var claims=await db.Events.AsNoTracking().Where(e=>e.CycleId==row.CycleId&&e.EventType=="cycleClaimed").ToArrayAsync(ct);
        var claimed=claims.Aggregate(BigInteger.Zero,(s,e)=>s+BigInteger.Parse(e.Amount));
        var report=await db.Verifications.AsNoTracking().SingleOrDefaultAsync(v=>v.CycleId==row.CycleId,ct);
        var miner=m.Miners.FirstOrDefault(m=>m.Wallet==wallet);
        return new {row.CycleId,row.Status,m.StartTime,m.EndTime,minerCount=m.Miners.Length,m.LeafCount,m.TotalPointUnits,m.RewardBudgetBaseUnits,m.TotalAllocatedBaseUnits,m.MerkleRoot,row.ManifestHash,row.PublicationSignature,row.PublishedSlot,row.Address,
            claimedBaseUnits=claimed.ToString(),remainingBaseUnits=(BigInteger.Parse(m.TotalAllocatedBaseUnits)-claimed).ToString(),claimCount=claims.Length,
            manifestUrl=$"/public/cycles/{m.GenesisHash}/{row.CycleId}/manifest.json",verification=report?.Status??"UNVERIFIABLE",verifiedAt=report?.VerifiedAt,
            wallet=miner==null?null:new {miner.Wallet,miner.PointUnits,miner.RewardBaseUnits,claimed=claims.Any(c=>c.Wallet==wallet)},
            claims=claims.Select(e=>new{e.Wallet,rewardBaseUnits=e.Amount,e.Signature,timestamp=e.BlockTime}),m.ProgramId,m.Mint,m.GenesisHash,row.InputThroughSlot,row.InputHash};
    }
    public static void MapProduct(this WebApplication app,string root)
    {
        foreach(var route in new[]{"/","/demo","/cycles","/cycles/{id}","/verify","/verify/{id}","/shitter/{wallet}","/about","/trust","/operator"}) app.MapGet(route,()=>Results.File(Path.Combine(root,"server","YetAnotherCat.Api","wwwroot","index.html"),"text/html"));
        app.MapGet("/public/cycles/{genesis}/{id}/manifest.json",Download);
        app.MapGet("/public/cycles/{id}/manifest.json",(string id,AccountingDb db,IManifestStorage storage,HttpContext context,CancellationToken ct)=>Download(id,null,db,storage,context,ct));
        app.MapGet("/api/cycles/{id}/verification",CachedVerification);
        app.MapGet("/api/cycles/{id}/verify",CachedVerification);
        app.MapGet("/api/explorer/config",(IConfiguration config,BackendSettings settings)=>new {cluster=config["YAC_CLUSTER"]??"localnet",explorerBase=config["YAC_EXPLORER_BASE"]??"https://explorer.solana.com",explorerRpc=config["YAC_EXPLORER_RPC_PUBLIC"],manifestPublicBaseUrl=config["YAC_MANIFEST_PUBLIC_BASE_URL"],programId=settings.ProgramId,trust=new {publisher="CENTRALIZED",challenge="NONE"}});
        app.MapGet("/api/explorer/cycles",async(int? offset,int? limit,string? wallet,AccountingDb db,CancellationToken ct)=> {
            if(offset<0||offset>100000||limit<1||limit>50||wallet!=null&&!ValidWallet(wallet))return Results.BadRequest();
            var rows=await db.Cycles.AsNoTracking().OrderByDescending(c=>c.StartTime).Skip(offset??0).Take(limit??12).ToArrayAsync(ct);
            var items=new List<object>();foreach(var row in rows)items.Add(await Summary(row,wallet,db,ct));
            return Results.Ok(new {items,offset=offset??0,nextOffset=rows.Length==(limit??12)?(int?)((offset??0)+rows.Length):null});
        });
        app.MapGet("/api/explorer/cycles/{id}",async(string id,string? wallet,AccountingDb db,CancellationToken ct)=> {
            if(!ValidId(id)||wallet!=null&&!ValidWallet(wallet))return Results.BadRequest();
            var row=await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c=>c.CycleId==id,ct);return row==null?Results.NotFound():Results.Ok(await Summary(row,wallet,db,ct));
        });
        app.MapGet("/api/cycles/{id}/verify-wallet/{wallet}",async(string id,string wallet,AccountingDb db,SettlementBridge bridge,CancellationToken ct)=> {
            if(!ValidId(id)||!ValidWallet(wallet))return Results.BadRequest();
            var row=await db.Cycles.AsNoTracking().SingleOrDefaultAsync(c=>c.CycleId==id&&c.Status=="PUBLISHED",ct);if(row==null)return Results.NotFound();
            var m=CycleService.Manifest(row);var miner=m.Miners.FirstOrDefault(p=>p.Wallet==wallet);var claim=await db.Events.AsNoTracking().FirstOrDefaultAsync(e=>e.CycleId==id&&e.Wallet==wallet&&e.EventType=="cycleClaimed",ct);
            var proof=miner==null||miner.RewardBaseUnits=="0"?null:JsonSerializer.Deserialize<Dictionary<string,ProofNode[]>>(row.ProofsJson,HistoryReader.Json)![wallet];
            var leaf=miner==null?null:Settlement.Leaf(id,miner);var report=await db.Verifications.AsNoTracking().SingleOrDefaultAsync(v=>v.CycleId==id,ct);
            return Results.Ok(new {wallet,cycleId=id,participated=miner!=null,pointUnits=miner?.PointUnits??"0",rewardBaseUnits=miner?.RewardBaseUnits??"0",leafHash=leaf,proof,proofValid=proof!=null&&Settlement.Verify(leaf!,proof,row.Root),merkleRoot=row.Root,claimed=claim!=null,claimSignature=claim?.Signature,claimedAt=claim?.BlockTime,cycleVerification=report?.Status??"UNVERIFIABLE"});
        });
        app.MapGet("/api/explorer/wallet/{wallet}",async(string wallet,AccountingDb db,Snapshots snapshots,IndexerHealth health,CancellationToken ct)=> {
            if(!ValidWallet(wallet))return Results.BadRequest();
            var rows=await db.Cycles.AsNoTracking().Where(c=>c.Status=="PUBLISHED").ToArrayAsync(ct);var claims=await db.Events.AsNoTracking().Where(e=>e.EventType=="cycleClaimed"&&e.Wallet==wallet).ToArrayAsync(ct);
            var earned=rows.Select(CycleService.Manifest).SelectMany(m=>m.Miners).Where(m=>m.Wallet==wallet).Aggregate(BigInteger.Zero,(s,m)=>s+BigInteger.Parse(m.RewardBaseUnits));var paid=claims.Aggregate(BigInteger.Zero,(s,e)=>s+BigInteger.Parse(e.Amount));
            return Results.Ok(new{wallet,accounting=await snapshots.Miner(wallet,health.Healthy,health.State.LatestSlot,ct),claimedBaseUnits=paid.ToString(),unclaimedBaseUnits=(earned-paid).ToString()});
        });
        app.MapGet("/api/stats",async(AccountingDb db,SettlementHealth health,CancellationToken ct)=> {
            var cp=await db.Checkpoints.AsNoTracking().SingleOrDefaultAsync(ct);var ps=await db.Projections.AsNoTracking().ToArrayAsync(ct);var claims=await db.Events.AsNoTracking().Where(e=>e.EventType=="cycleClaimed").ToArrayAsync(ct);
            return new{activeMiners=ps.Count(p=>p.Rate!="0"),lockedBaseUnits=ps.Aggregate(BigInteger.Zero,(s,p)=>s+BigInteger.Parse(p.Locked)).ToString(),lifetimePointUnits=ps.Aggregate(BigInteger.Zero,(s,p)=>s+BigInteger.Parse(p.Units)+Points.Accrue(BigInteger.Parse(p.Rate),p.LastAccrualTime,cp?.ThroughTime??p.LastAccrualTime)).ToString(),publishedCycles=await db.Cycles.CountAsync(c=>c.Status=="PUBLISHED",ct),distributedBaseUnits=claims.Aggregate(BigInteger.Zero,(s,e)=>s+BigInteger.Parse(e.Amount)).ToString(),rewardReserveBaseUnits=health.State?.VaultBalance,finalizedThroughTime=cp?.ThroughTime,stale=!health.Healthy};
        });
        app.MapGet("/api/operator/status",(OperationsState state)=>state.Snapshot==null?Results.Json(new{status="degraded",error="Operational checks initializing"},statusCode:503):Results.Ok(new{state.Status,state.UpdatedAt,snapshot=state.Snapshot}));
        app.MapPost("/api/operator/cycles/{id}/verify",async(string id,AccountingDb db,CycleVerification verifier,CancellationToken ct)=> {
            if(!ValidId(id))return Results.BadRequest();var row=await db.Cycles.SingleOrDefaultAsync(c=>c.CycleId==id,ct);return row==null?Results.NotFound():Results.Ok(await verifier.Verify(row,ct:ct,component:"operator"));
        }).RequireRateLimiting("verification");
    }
}
