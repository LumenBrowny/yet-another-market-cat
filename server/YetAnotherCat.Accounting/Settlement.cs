using System.Buffers.Binary;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace YetAnotherCat.Accounting;

public sealed record WalletPoints(string Wallet, string PointUnits);
public sealed record CycleMiner(string Wallet, string PointUnits, string RewardBaseUnits);
public sealed record ProofNode(string Hash, bool Left);
public sealed record CycleMetadata(string ProgramId, string Mint, string GenesisHash, string CycleId, long StartTime, long EndTime);
public sealed record CycleManifest(int Version, string Project, string ProgramId, string Mint, string GenesisHash, string CycleId,
    string StartTime, string EndTime, string PointScale, string TotalPointUnits, string RewardBudgetBaseUnits,
    string TotalAllocatedBaseUnits, int LeafCount, string MerkleRoot, CycleMiner[] Miners);
public sealed record CycleSettlement(CycleManifest Manifest, string Canonical, string ManifestHash, Dictionary<string, ProofNode[]> Proofs);

public static class Settlement
{
    private const string Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    public static byte[] PublicKey(string value)
    {
        BigInteger n = 0;
        foreach (var c in value) { var i = Alphabet.IndexOf(c); if (i < 0) throw new ArgumentException("Invalid base58"); n = n * 58 + i; }
        var data = n.IsZero ? [] : n.ToByteArray(isUnsigned: true, isBigEndian: true);
        var zeros = value.TakeWhile(c => c == '1').Count();
        if (data.Length + zeros != 32) throw new ArgumentException("Public key must encode exactly 32 bytes");
        return Enumerable.Repeat((byte)0, zeros).Concat(data).ToArray();
    }
    public static string WalletOrder(string wallet) => Convert.ToHexString(PublicKey(wallet));
    public static (long Start, long End) Bounds(long genesis, long duration, ulong cycleId)
    {
        if (genesis < 0 || duration <= 0) throw new ArgumentOutOfRangeException(nameof(duration));
        var start = checked(genesis + checked((long)cycleId * duration));
        return (start, checked(start + duration));
    }
    public static ulong? CycleId(long genesis, long duration, long timestamp) => timestamp < genesis ? null : duration > 0 ? checked((ulong)((timestamp - genesis) / duration)) : throw new ArgumentOutOfRangeException(nameof(duration));
    public static byte[] Unsigned(BigInteger value, int bytes, bool bigEndian = false)
    {
        if (value < 0 || value >= (BigInteger.One << (bytes * 8))) throw new OverflowException("Settlement integer outside wire bounds");
        var raw = value.ToByteArray(isUnsigned: true, isBigEndian: bigEndian);
        var result = new byte[bytes]; raw.CopyTo(result, bigEndian ? bytes - raw.Length : 0); return result;
    }
    public static string Hash(byte[] data) => Convert.ToHexStringLower(SHA256.HashData(data));
    public static string EmptyRoot => Hash(Encoding.ASCII.GetBytes("YAC_EMPTY_CYCLE_V1"));
    public static byte[] LeafPreimage(string cycleId, string wallet, string points, string reward) => new byte[] { 0 }
        .Concat(Encoding.ASCII.GetBytes("YAC_CYCLE_REWARD_V1")).Concat(Unsigned(Points.Integer(cycleId), 8))
        .Concat(PublicKey(wallet)).Concat(Unsigned(Points.Integer(points), 32, true)).Concat(Unsigned(Points.Integer(reward), 8)).ToArray();
    public static string Leaf(string cycleId, CycleMiner miner) => Hash(LeafPreimage(cycleId, miner.Wallet, miner.PointUnits, miner.RewardBaseUnits));
    public static string Node(string left, string right) => Hash(new byte[] { 1 }.Concat(Convert.FromHexString(left)).Concat(Convert.FromHexString(right)).ToArray());
    public static bool Verify(string leaf, IEnumerable<ProofNode> proof, string root)
    {
        var nodes = proof.ToArray(); if (nodes.Length > 16) return false;
        foreach (var node in nodes) leaf = node.Left ? Node(node.Hash, leaf) : Node(leaf, node.Hash);
        return leaf == root;
    }
    public static CycleMiner[] AllocateRewards(IEnumerable<WalletPoints> input, BigInteger budget)
    {
        _ = Unsigned(budget, 8);
        var points = input.OrderBy(p => WalletOrder(p.Wallet), StringComparer.Ordinal).ToArray();
        if (points.Select(p => p.Wallet).Distinct(StringComparer.Ordinal).Count() != points.Length) throw new ArgumentException("Duplicate wallet");
        foreach (var p in points) _ = Unsigned(Points.Integer(p.PointUnits), 32, true);
        points = points.Where(p => Points.Integer(p.PointUnits) > 0).ToArray();
        var total = points.Aggregate(BigInteger.Zero, (s, p) => s + Points.Integer(p.PointUnits));
        if (total == 0) return [];
        var amounts = points.Select(p => budget * Points.Integer(p.PointUnits) / total).ToArray();
        var left = checked((int)(budget - amounts.Aggregate(BigInteger.Zero, (s, x) => s + x)));
        var winners = Enumerable.Range(0, points.Length).OrderByDescending(i => budget * Points.Integer(points[i].PointUnits) % total).ThenBy(i => WalletOrder(points[i].Wallet), StringComparer.Ordinal).Take(left);
        foreach (var i in winners) amounts[i]++;
        return points.Select((p, i) => new CycleMiner(p.Wallet, p.PointUnits, amounts[i].ToString(System.Globalization.CultureInfo.InvariantCulture))).ToArray();
    }
    public static CycleSettlement BuildCycleSettlement(CycleMetadata metadata, IEnumerable<WalletPoints> points, BigInteger budget)
    {
        if (metadata.EndTime <= metadata.StartTime || metadata.StartTime < 0 || budget <= 0) throw new ArgumentException("Invalid cycle bounds/budget");
        _ = PublicKey(metadata.ProgramId); _ = PublicKey(metadata.Mint); _ = PublicKey(metadata.GenesisHash);
        _ = Unsigned(Points.Integer(metadata.CycleId), 8);
        var miners = AllocateRewards(points, budget);
        var leaves = miners.Where(m => Points.Integer(m.RewardBaseUnits) > 0).ToArray();
        if (leaves.Length > 65536) throw new ArgumentException("Maximum supported tree is 65536 leaves");
        var levels = new List<string[]> { leaves.Select(m => Leaf(metadata.CycleId, m)).ToArray() };
        while (levels[^1].Length > 1)
        {
            var previous = levels[^1];
            levels.Add(Enumerable.Range(0, (previous.Length + 1) / 2).Select(i => Node(previous[i * 2], previous[Math.Min(i * 2 + 1, previous.Length - 1)])).ToArray());
        }
        var proofs = new Dictionary<string, ProofNode[]>(StringComparer.Ordinal);
        for (var i = 0; i < leaves.Length; i++)
        {
            var proof = new List<ProofNode>(); var index = i;
            foreach (var level in levels.Take(levels.Count - 1)) { proof.Add(new(level[Math.Min(index ^ 1, level.Length - 1)], (index & 1) == 1)); index /= 2; }
            proofs.Add(leaves[i].Wallet, proof.ToArray());
        }
        var total = miners.Aggregate(BigInteger.Zero, (s, m) => s + Points.Integer(m.PointUnits));
        _ = Unsigned(total, 32, true);
        var manifest = new CycleManifest(1, "yet-another-cat", metadata.ProgramId, metadata.Mint, metadata.GenesisHash, metadata.CycleId,
            metadata.StartTime.ToString(), metadata.EndTime.ToString(), "1000", total.ToString(), budget.ToString(), miners.Length == 0 ? "0" : budget.ToString(), leaves.Length, leaves.Length == 0 ? EmptyRoot : levels[^1][0], miners);
        var canonical = Canonical(manifest);
        return new(manifest, canonical, Hash(Encoding.UTF8.GetBytes(canonical)), proofs);
    }
    public static string Canonical(CycleManifest m)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            w.WriteStartObject(); w.WriteNumber("version", m.Version); w.WriteString("project", m.Project);
            w.WriteString("programId", m.ProgramId); w.WriteString("mint", m.Mint); w.WriteString("genesisHash", m.GenesisHash);
            w.WriteString("cycleId", m.CycleId); w.WriteString("startTime", m.StartTime); w.WriteString("endTime", m.EndTime);
            w.WriteString("pointScale", m.PointScale); w.WriteString("totalPointUnits", m.TotalPointUnits);
            w.WriteString("rewardBudgetBaseUnits", m.RewardBudgetBaseUnits); w.WriteString("totalAllocatedBaseUnits", m.TotalAllocatedBaseUnits);
            w.WriteNumber("leafCount", m.LeafCount); w.WriteString("merkleRoot", m.MerkleRoot); w.WriteStartArray("miners");
            foreach (var p in m.Miners) { w.WriteStartObject(); w.WriteString("wallet", p.Wallet); w.WriteString("pointUnits", p.PointUnits); w.WriteString("rewardBaseUnits", p.RewardBaseUnits); w.WriteEndObject(); }
            w.WriteEndArray(); w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }
}
