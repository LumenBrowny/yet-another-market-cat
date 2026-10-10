using System.Text.Json;
using YetAnotherCat.Infrastructure;
namespace YetAnotherCat.Api;
public static class RecoveryStatus
{
    public static object Read(BackendSettings settings)
    {
        var root=Path.Combine(settings.Root,".dev");
        object? ReadJson(string name) {try {return JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(Path.Combine(root,name)));}catch(IOException){return null;}catch(JsonException){return null;}}
        var cache=Environment.GetEnvironmentVariable("YAC_FINALIZED_BLOCK_CACHE");
        long bytes=0;int entries=0;
        if(!string.IsNullOrEmpty(cache)&&Directory.Exists(cache))foreach(var f in Directory.EnumerateFiles(cache,"*.gz",SearchOption.AllDirectories))try {bytes+=new FileInfo(f).Length;entries++;}catch(IOException){}
        return new {verifyRpc=new Uri(Environment.GetEnvironmentVariable("YAC_RPC_VERIFY")??settings.RpcUrl).Host,verificationTimeoutSeconds=RecoveryPolicy.TimeoutSeconds("verify-chain",Environment.GetEnvironmentVariable("YAC_VERIFY_TIMEOUT_SECONDS")),blockCachePath=cache,blockCacheEntries=entries,blockCacheBytes=bytes,lastVerification=ReadJson("last-verification.json"),catchup=ReadJson("catchup-status.json")};
    }
}
