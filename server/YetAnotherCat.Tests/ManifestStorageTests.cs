using System.Text;
using Xunit;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Tests;
public sealed class ManifestStorageTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"yac-storage-test-"+Guid.NewGuid().ToString("N"));
    private const string Genesis="11111111111111111111111111111111";
    [Theory]
    [InlineData("../1")][InlineData("01")][InlineData("-1")][InlineData("18446744073709551616")][InlineData(" 1")]
    public void RejectsNoncanonicalIds(string id)=>Assert.Throws<ArgumentException>(()=>ManifestIdentity.Key(Genesis,id));
    [Fact]
    public void RejectsGenesisTraversal()=>Assert.Throws<ArgumentException>(()=>ManifestIdentity.Key("../../outside","1"));
    [Fact]
    public async Task MissingIsDistinctFromCorruption()
    {
        var storage=new LocalManifestStorage(root);
        Assert.Null(await storage.Get(Genesis,"4")); Assert.False(await storage.Exists(Genesis,"4"));
        var bytes=Encoding.UTF8.GetBytes("canonical\n");
        await Assert.ThrowsAsync<InvalidDataException>(()=>storage.Put(Genesis,"4",bytes,new string('0',64)));
        Assert.False(await storage.Exists(Genesis,"4"));
    }
    [Fact]
    public async Task ConcurrentIdempotentWritesPreserveExactBytesAndRejectOverwrite()
    {
        var storage=new LocalManifestStorage(root);var bytes=Encoding.UTF8.GetBytes("{\"unicode\":\"💩\"}\n");
        for(var cycle=4;cycle<12;cycle++){
            var id=cycle.ToString();
            await Task.WhenAll(Enumerable.Range(0,12).Select(_=>storage.Put(Genesis,id,bytes,Settlement.Hash(bytes))));
            Assert.Equal(bytes,await storage.Get(Genesis,id));
        }
        Assert.Equal(bytes,await storage.Get(Genesis,"4"));
        var changed=Encoding.UTF8.GetBytes("{}");
        await Assert.ThrowsAsync<InvalidDataException>(()=>storage.Put(Genesis,"4",changed,Settlement.Hash(changed)));
        Assert.Equal(bytes,await storage.Get(Genesis,"4"));
        Assert.Empty(Directory.GetFiles(root,"*.tmp",SearchOption.AllDirectories));
    }
    public void Dispose(){if(Directory.Exists(root))Directory.Delete(root,true);}
}
