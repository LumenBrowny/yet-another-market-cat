using System.Numerics;
using System.Text.Json;
using Xunit;
using YetAnotherCat.Accounting;
using YetAnotherCat.Infrastructure;

namespace YetAnotherCat.Tests;

public sealed class SettlementTests
{
    public static IEnumerable<object[]> Vectors() => JsonDocument.Parse(File.ReadAllText("settlement-vectors.json")).RootElement.EnumerateArray().Select(v => new object[] { v.Clone() });
    [Theory, MemberData(nameof(Vectors))]
    public void CrossLanguageBytesHashesAndProofs(JsonElement vector)
    {
        var manifest = vector.GetProperty("manifest").Deserialize<CycleManifest>(HistoryReader.Json)!;
        var settlement = Settlement.BuildCycleSettlement(new(manifest.ProgramId, manifest.Mint, manifest.GenesisHash, manifest.CycleId, long.Parse(manifest.StartTime), long.Parse(manifest.EndTime)), manifest.Miners.Select(m => new WalletPoints(m.Wallet, m.PointUnits)), Points.Integer(manifest.RewardBudgetBaseUnits));
        Assert.Equal(vector.GetProperty("canonical").GetString(), settlement.Canonical);
        Assert.Equal(vector.GetProperty("manifestHash").GetString(), settlement.ManifestHash);
        Assert.Equal(manifest.MerkleRoot, settlement.Manifest.MerkleRoot);
        foreach (var leaf in vector.GetProperty("leaves").EnumerateArray())
        {
            var wallet = leaf.GetProperty("wallet").GetString()!;
            var miner = manifest.Miners.Single(m => m.Wallet == wallet);
            Assert.Equal(leaf.GetProperty("preimage").GetString(), Convert.ToHexStringLower(Settlement.LeafPreimage(manifest.CycleId, wallet, miner.PointUnits, miner.RewardBaseUnits)));
            Assert.Equal(leaf.GetProperty("hash").GetString(), Settlement.Leaf(manifest.CycleId, miner));
            Assert.Equal(JsonSerializer.Serialize(leaf.GetProperty("proof")), JsonSerializer.Serialize(settlement.Proofs[wallet], HistoryReader.Json));
            Assert.True(Settlement.Verify(Settlement.Leaf(manifest.CycleId, miner), settlement.Proofs[wallet], manifest.MerkleRoot));
        }
    }
    private const string A = "11111111111111111111111111111111";
    private const string B = "11111111111111111111111111111112";
    private const string C = "11111111111111111111111111111113";
    [Fact]
    public void BoundsAndCycleIdsHaveExactEdges()
    {
        Assert.Null(Settlement.CycleId(1000, 100, 999));
        Assert.Equal(0UL, Settlement.CycleId(1000, 100, 1000));
        Assert.Equal(0UL, Settlement.CycleId(1000, 100, 1099));
        Assert.Equal(1UL, Settlement.CycleId(1000, 100, 1100));
        Assert.Equal((1100L, 1200L), Settlement.Bounds(1000, 100, 1));
        Assert.Throws<OverflowException>(() => Settlement.Bounds(1000, 86400, ulong.MaxValue));
    }
    [Fact]
    public void RemainderUsesRawWalletOrderRegardlessOfInput()
    {
        var result = Settlement.AllocateRewards([new(C, "1"), new(B, "1"), new(A, "1")], 2);
        Assert.Equal(new[] { "1", "1", "0" }, result.Select(r => r.RewardBaseUnits));
        Assert.Equal(new[] { A, B, C }, result.Select(r => r.Wallet));
    }
    [Fact]
    public void UnequalSharesAndHugePointsRemainExact()
    {
        var scale = BigInteger.Pow(10, 60);
        var result = Settlement.AllocateRewards([new(A, (50 * scale).ToString()), new(B, (30 * scale).ToString()), new(C, (20 * scale).ToString())], 10000);
        Assert.Equal(new[] { "5000", "3000", "2000" }, result.Select(r => r.RewardBaseUnits));
        Assert.Equal("1", Settlement.AllocateRewards([new(A, "999"), new(B, "1")], 1).First().RewardBaseUnits);
    }
    [Fact]
    public void EmptySingleAndWireBounds()
    {
        Assert.Empty(Settlement.AllocateRewards([], 100));
        Assert.Equal("100", Settlement.AllocateRewards([new(A, "1")], 100).Single().RewardBaseUnits);
        Assert.Throws<ArgumentException>(() => Settlement.AllocateRewards([new(A, "1"), new(A, "2")], 100));
        Assert.Throws<OverflowException>(() => Settlement.Unsigned(BigInteger.One << 256, 32, true));
        Assert.Throws<OverflowException>(() => Settlement.AllocateRewards([new(A, "-1")], 100));
    }
    [Fact]
    public void MidCycleChangeUsesAccountingIntervals()
    {
        var transitions = new[] { new Transition(0, 1_000_000_000, 1, 0, 0), new Transition(50, 25_000_000_000, 2, 0, 0) };
        var a = Points.CalculatePoints(transitions, 0, 100);
        var b = Points.CalculatePoints([new(0, 5_000_000_000, 1, 0, 0)], 0, 100);
        var rewards = Settlement.AllocateRewards([new(A, a.ToString()), new(B, b.ToString())], 10000);
        Assert.Equal(new[] { "6000", "4000" }, rewards.Select(r => r.RewardBaseUnits));
    }
}
