using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace YetAnotherCat.Infrastructure;

public sealed class VerificationRecord
{
    public string CycleId { get; set; } = "";
    public string ManifestHash { get; set; } = "";
    public string Root { get; set; } = "";
    public string Status { get; set; } = "UNVERIFIABLE";
    public long VerifiedAt { get; set; }
    public string ReportJson { get; set; } = "{}";
}
public sealed class OperatorEvent
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long Timestamp { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    public string Severity { get; set; } = "INFO";
    public string Kind { get; set; } = "";
    public string CycleId { get; set; } = "";
    public string Message { get; set; } = "";
}
public sealed class CycleVerification(AccountingDb db, SettlementBridge bridge, IManifestStorage storage)
{
    public async Task<JsonElement> Verify(CycleRecord cycle, bool beforePublication = false, CancellationToken ct = default, string? component = null)
    {
        var report=await bridge.Call(beforePublication?"verify-before-publish":"verify-chain", CycleService.Manifest(cycle),ct:ct,canonical:cycle.ManifestJson,component:component);
        if (!beforePublication) {
            await StoreReport(cycle, report, ct);
        }
        return report;
    }
    public async Task StoreReport(CycleRecord cycle, JsonElement report, CancellationToken ct=default)
    {
            if(report.GetProperty("cycleId").GetString()!=cycle.CycleId)throw new InvalidOperationException("Verification report cycle identity mismatch");
            var record=await db.Verifications.FindAsync([cycle.CycleId],ct) ?? new VerificationRecord { CycleId=cycle.CycleId };
            if(db.Entry(record).State==EntityState.Detached) db.Verifications.Add(record);
            record.ManifestHash=cycle.ManifestHash; record.Root=cycle.Root; record.Status=report.GetProperty("result").GetString()!;
            record.VerifiedAt=DateTimeOffset.UtcNow.ToUnixTimeSeconds(); record.ReportJson=report.GetRawText();
            db.OperatorEvents.Add(new() { Kind="cycle_verified",CycleId=cycle.CycleId,Severity=record.Status=="VALID"?"INFO":record.Status=="INVALID"?"CRITICAL":"WARNING",Message=record.Status });
            await db.SaveChangesAsync(ct);
    }
    public async Task Persist(CycleRecord cycle, CancellationToken ct = default)
    {
        var m=CycleService.Manifest(cycle);
        await storage.Put(m.GenesisHash,cycle.CycleId,Encoding.UTF8.GetBytes(cycle.ManifestJson),cycle.ManifestHash,ct);
        db.OperatorEvents.Add(new() { Kind="manifest_uploaded",CycleId=cycle.CycleId,Message="Canonical bytes stored and read back: "+storage.Provider });
        await db.SaveChangesAsync(ct);
    }
    public async Task<string> Audit(CycleRecord cycle, JsonElement chain, CancellationToken ct = default)
    {
        try {
            CycleService.CheckPublished(cycle,chain);
            var stored=await storage.Get(CycleService.Manifest(cycle).GenesisHash,cycle.CycleId,ct);
            if(stored==null) return "MISSING";
            ManifestIdentity.Verify(stored,cycle.ManifestHash); ManifestIdentity.Same(stored,Encoding.UTF8.GetBytes(cycle.ManifestJson)); return "OK";
        } catch(InvalidDataException) { return "HASH_MISMATCH"; }
        catch(InvalidOperationException) { return "CHAIN_MISMATCH"; }
    }
}
