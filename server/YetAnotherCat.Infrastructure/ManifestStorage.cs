using System.Net;
using System.Security.Cryptography;
using Amazon.S3;
using Amazon.S3.Model;
using YetAnotherCat.Accounting;

namespace YetAnotherCat.Infrastructure;

public interface IManifestStorage
{
    string Provider { get; }
    Task Put(string genesis, string cycleId, byte[] canonical, string expectedHash, CancellationToken ct = default);
    Task<byte[]?> Get(string genesis, string cycleId, CancellationToken ct = default);
    Task<bool> Exists(string genesis, string cycleId, CancellationToken ct = default);
}
public static class ManifestIdentity
{
    public static string Key(string genesis, string id)
    {
        _ = Settlement.PublicKey(genesis);
        if (!ulong.TryParse(id, out var number) || number.ToString(System.Globalization.CultureInfo.InvariantCulture) != id) throw new ArgumentException("Invalid canonical cycle ID");
        return $"cycles/{genesis}/{id}/manifest.json";
    }
    public static void Verify(byte[] data, string hash)
    {
        if (Convert.ToHexStringLower(SHA256.HashData(data)) != hash) throw new InvalidDataException("Manifest SHA-256 mismatch");
    }
    public static void Same(byte[] existing, byte[] candidate)
    {
        if (!existing.AsSpan().SequenceEqual(candidate)) throw new InvalidDataException("Immutable manifest conflict; refusing overwrite");
    }
}
public sealed class LocalManifestStorage(string root) : IManifestStorage
{
    public string Provider => "local";
    private string PathFor(string genesis, string id) => Path.Combine(Path.GetFullPath(root), ManifestIdentity.Key(genesis,id).Replace('/',Path.DirectorySeparatorChar));
    public async Task<byte[]?> Get(string genesis, string cycleId, CancellationToken ct = default)
    {
        for(var attempt=0;;attempt++) {
            try { return await File.ReadAllBytesAsync(PathFor(genesis,cycleId),ct); }
            catch (FileNotFoundException) { return null; }
            catch (DirectoryNotFoundException) { return null; }
            // Windows may briefly hold the destination exclusively during an atomic rename.
            catch(IOException ex) when(attempt<5 && (ex.HResult & 0xffff) is 32 or 33) { await Task.Delay(20*(attempt+1),ct); }
        }
    }
    public Task<bool> Exists(string genesis, string cycleId, CancellationToken ct = default) => Task.FromResult(File.Exists(PathFor(genesis,cycleId)));
    public async Task Put(string genesis, string cycleId, byte[] canonical, string expectedHash, CancellationToken ct = default)
    {
        ManifestIdentity.Verify(canonical,expectedHash);
        var path=PathFor(genesis,cycleId); Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var prior=await Get(genesis,cycleId,ct); if(prior!=null) { ManifestIdentity.Same(prior,canonical); return; }
        var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try {
            await File.WriteAllBytesAsync(temporary,canonical,ct);
            try { File.Move(temporary,path,false); }
            catch(IOException) when(File.Exists(path)) { ManifestIdentity.Same(await Get(genesis,cycleId,ct)??throw new IOException("Concurrent object disappeared"),canonical); }
        } finally { if(File.Exists(temporary)) File.Delete(temporary); }
        ManifestIdentity.Verify((await Get(genesis,cycleId,ct))!,expectedHash);
    }
}
public sealed class S3ManifestStorage(IAmazonS3 client, string bucket, string prefix = "") : IManifestStorage
{
    private string Key(string genesis, string id) => (string.IsNullOrEmpty(prefix) ? "" : prefix.Trim('/') + "/") + ManifestIdentity.Key(genesis, id);
    public async Task InitializeBucket(CancellationToken ct = default)
    {
        try { await client.PutBucketAsync(new PutBucketRequest { BucketName=bucket },ct); }
        catch(AmazonS3Exception e) when(e.ErrorCode=="BucketAlreadyOwnedByYou") { }
    }
    public string Provider => "s3";
    public async Task<byte[]?> Get(string genesis, string cycleId, CancellationToken ct = default)
    {
        try {
            using var response=await client.GetObjectAsync(bucket,Key(genesis,cycleId),ct);
            using var output=new MemoryStream(); await response.ResponseStream.CopyToAsync(output,ct); return output.ToArray();
        } catch(AmazonS3Exception e) when(e.StatusCode==HttpStatusCode.NotFound && e.ErrorCode!="NoSuchBucket") { return null; }
    }
    public async Task<bool> Exists(string genesis, string cycleId, CancellationToken ct = default) => await Get(genesis,cycleId,ct)!=null;
    public async Task Put(string genesis, string cycleId, byte[] canonical, string expectedHash, CancellationToken ct = default)
    {
        ManifestIdentity.Verify(canonical,expectedHash);
        using var input=new MemoryStream(canonical,false);
        try {
            await client.PutObjectAsync(new PutObjectRequest { BucketName=bucket, Key=Key(genesis,cycleId), InputStream=input, ContentType="application/json", IfNoneMatch="*", UseChunkEncoding=false },ct);
        } catch(AmazonS3Exception e) when(e.StatusCode==HttpStatusCode.PreconditionFailed || e.StatusCode==HttpStatusCode.Conflict) {
            var existing=await Get(genesis,cycleId,ct) ?? throw new IOException("Conditional storage race; retry upload"); ManifestIdentity.Same(existing,canonical);
        }
        var stored=await Get(genesis,cycleId,ct) ?? throw new IOException("Stored manifest unavailable");
        ManifestIdentity.Same(stored,canonical); ManifestIdentity.Verify(stored,expectedHash);
    }
}
