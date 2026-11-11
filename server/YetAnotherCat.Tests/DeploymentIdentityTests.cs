using YetAnotherCat.Api;
using YetAnotherCat.Infrastructure;
using Xunit;

namespace YetAnotherCat.Tests;
public class DeploymentIdentityTests
{
    private const string Program = "BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW";
    private static IndexerCheckpoint Checkpoint() => new() { ProgramId=Program, Mint=Program, GenesisHash=DeploymentIdentity.MainnetGenesis };
    [Fact] public void UsesIndexedIdentityAndRejectsInconsistentConfiguration() {
        var cp=Checkpoint();
        var identity=DeploymentIdentity.FromCheckpoint("mainnet-beta",Program,cp);
        Assert.NotNull(identity); Assert.Equal(cp.Mint,identity.Mint); Assert.Equal(1,identity.Version);
        Assert.Null(DeploymentIdentity.FromCheckpoint("mainnet-beta",Program,null));
        Assert.Null(DeploymentIdentity.FromCheckpoint("devnet",Program,cp));
        Assert.Null(DeploymentIdentity.FromCheckpoint("unknown",Program,cp));
        Assert.Null(DeploymentIdentity.FromCheckpoint("mainnet-beta","11111111111111111111111111111111",cp));
        cp.GenesisHash=Program;
        Assert.Null(DeploymentIdentity.FromCheckpoint("mainnet-beta",Program,cp));
        Assert.NotNull(DeploymentIdentity.FromCheckpoint("localnet",Program,cp));
        cp.Mint="invalid";
        Assert.Null(DeploymentIdentity.FromCheckpoint("localnet",Program,cp));
    }
}
