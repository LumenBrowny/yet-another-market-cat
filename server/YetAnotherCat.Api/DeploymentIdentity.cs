using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Api;

// Derived from indexed chain identity, never from a hand-written mint label.
public sealed record DeploymentIdentity(int Version, string Cluster, string ProgramId, string Mint, string GenesisHash)
{
    public const string MainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

    public static DeploymentIdentity? FromCheckpoint(string cluster, string programId, IndexerCheckpoint? checkpoint)
    {
        if (checkpoint == null || checkpoint.ProgramId != programId ||
            !ProductApi.ValidWallet(programId) || !ProductApi.ValidWallet(checkpoint.Mint) ||
            !ProductApi.ValidWallet(checkpoint.GenesisHash) ||
            cluster is not ("localnet" or "devnet" or "mainnet-beta") ||
            (cluster == "mainnet-beta") != (checkpoint.GenesisHash == MainnetGenesis)) return null;
        return new(1, cluster, programId, checkpoint.Mint, checkpoint.GenesisHash);
    }
}
