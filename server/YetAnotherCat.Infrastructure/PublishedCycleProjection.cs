using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace YetAnotherCat.Infrastructure;

public sealed class PublishedCycleProjection
{
    public long CycleId { get; set; }
    public string ImmutableJson { get; set; } = "";
    public string Hash { get; set; } = "";
    public string AuditedClaimedAmount { get; set; } = "0";
}
public sealed class CycleProjectionCheckpoint
{
    public string ProgramId { get; set; } = "";
    public string GenesisHash { get; set; } = "";
    public string Mint { get; set; } = "";
    public long NextCycle { get; set; }
    public long AuditedAt { get; set; }
}

public static class CycleProjectionStore
{
    public static async Task<JsonElement> Refresh(AccountingDb db, Func<Task<JsonElement>> readState,
        Func<string, long, long, Task<JsonElement>> fetch, CancellationToken ct)
    {
        // API and recovery CLI are separate processes. Serialize discovery across them,
        // taking a fresh chain snapshot only after the preceding writer has committed.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        if (db.Database.IsNpgsql())
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(25123012001)", ct);
        var result = await Merge(db, await readState(), fetch, ct);
        await transaction.CommitAsync(ct);
        return result;
    }
    public static string Immutable(JsonElement value)
    {
        var fields = new SortedDictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var p in value.EnumerateObject()) if (p.Name != "claimedAmount") fields.Add(p.Name, p.Value);
        return JsonSerializer.Serialize(fields);
    }
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static void Validate(IReadOnlyList<PublishedCycleProjection> rows, long next)
    {
        if (rows.Count != next) throw new InvalidOperationException("CRITICAL: cycle projection has gaps");
        for (var i = 0; i < rows.Count; i++) {
            var row = rows[i];
            if (row.CycleId != i || Hash(row.ImmutableJson) != row.Hash ||
                JsonSerializer.Deserialize<JsonElement>(row.ImmutableJson).GetProperty("cycleId").GetString() != i.ToString())
                throw new InvalidOperationException("CRITICAL: corrupt cycle projection");
        }
    }
    public static async Task<JsonElement> Merge(AccountingDb db, JsonElement state,
        Func<string, long, long, Task<JsonElement>> fetch, CancellationToken ct)
    {
        var config = state.GetProperty("config");
        var program = state.GetProperty("programId").GetString()!;
        var genesis = state.GetProperty("genesisHash").GetString()!;
        var mint = config.GetProperty("tokenMint").GetString()!;
        var next = long.Parse(config.GetProperty("nextCycle").GetString()!);
        var cp = await db.CycleProjectionCheckpoints.SingleOrDefaultAsync(ct);
        var rows = await db.PublishedCycleProjections.OrderBy(c => c.CycleId).ToListAsync(ct);
        if (cp == null) {
            if (rows.Count != 0) throw new InvalidOperationException("CRITICAL: missing cycle discovery checkpoint");
            cp = new() { ProgramId = program, GenesisHash = genesis, Mint = mint };
            db.CycleProjectionCheckpoints.Add(cp);
        }
        if (cp.ProgramId != program || cp.GenesisHash != genesis || cp.Mint != mint || cp.NextCycle > next)
            throw new InvalidOperationException("CRITICAL: cycle projection deployment mismatch or rollback");
        Validate(rows, cp.NextCycle);
        if (cp.NextCycle < next) {
            var discovered = await fetch("cycle-discovery", cp.NextCycle, next);
            foreach (var item in discovered.EnumerateArray()) {
                var id = long.Parse(item.GetProperty("cycleId").GetString()!);
                if (id != rows.Count) throw new InvalidOperationException("CRITICAL: discovery is not contiguous");
                var immutable = Immutable(item);
                var row = new PublishedCycleProjection { CycleId = id, ImmutableJson = immutable, Hash = Hash(immutable), AuditedClaimedAmount = item.GetProperty("claimedAmount").GetString()! };
                rows.Add(row); db.PublishedCycleProjections.Add(row);
            }
            if (rows.Count != next) throw new InvalidOperationException("CRITICAL: incomplete cycle discovery");
            cp.NextCycle = next;
        }
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (cp.AuditedAt <= now - 3600) {
            var audited = next == 0 ? JsonSerializer.SerializeToElement(Array.Empty<object>()) : await fetch("cycle-audit", 0, next);
            if (audited.GetArrayLength() != rows.Count) throw new InvalidOperationException("CRITICAL: audit count mismatch");
            for (var i = 0; i < rows.Count; i++) {
                if (Immutable(audited[i]) != rows[i].ImmutableJson) throw new InvalidOperationException("CRITICAL: published immutable cycle mismatch");
                rows[i].AuditedClaimedAmount = audited[i].GetProperty("claimedAmount").GetString()!;
            }
            cp.AuditedAt = now;
        }
        // EF SaveChanges atomically persists rows and their discovery/audit checkpoint.
        await db.SaveChangesAsync(ct);
        var claims = (await db.Events.AsNoTracking().Where(e => e.EventType == "cycleClaimed").ToListAsync(ct))
            .GroupBy(e => e.CycleId).ToDictionary(g => g.Key, g => g.Aggregate(System.Numerics.BigInteger.Zero, (sum,e) => sum + System.Numerics.BigInteger.Parse(e.Amount)).ToString());
        var result = JsonNode.Parse(state.GetRawText())!;
        result["cycles"] = new JsonArray(rows.Select(row => {
            var node = JsonNode.Parse(row.ImmutableJson)!;
            // Event-derived, authoritative through the indexer checkpoint, never advertised as a fresh account read.
            node["claimedAmount"] = claims.GetValueOrDefault(row.CycleId.ToString(), "0"); return node;
        }).ToArray());
        result["cycleProjectionCount"] = rows.Count;
        result["lastCycleAudit"] = cp.AuditedAt;
        result["claimedAmountSource"] = "finalized-event-projection";
        return JsonSerializer.SerializeToElement(result);
    }
}
