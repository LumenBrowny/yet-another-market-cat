using Microsoft.EntityFrameworkCore;
using YetAnotherCat.Accounting;

namespace YetAnotherCat.Infrastructure;

public sealed class ChainEvent
{
    public string CycleId { get; set; } = "";
    public string Id { get; set; } = "";
    public string Signature { get; set; } = "";
    public long Slot { get; set; }
    public int TransactionIndex { get; set; }
    public int EventIndex { get; set; }
    public long BlockTime { get; set; }
    public string EventType { get; set; } = "";
    public string Wallet { get; set; } = "";
    public string Position { get; set; } = "";
    public string Amount { get; set; } = "0";
    public string EffectiveLockedAmount { get; set; } = "0";
    public string RawPayload { get; set; } = "";
    public int Version { get; set; } = 1;
}
public sealed class MiningProjection
{
    public string Wallet { get; set; } = "";
    public string Position { get; set; } = "";
    public string Locked { get; set; } = "0";
    public string Units { get; set; } = "0";
    public long LastAccrualTime { get; set; }
    public long LastProcessedSlot { get; set; }
    public string Pending { get; set; } = "0";
    public long WithdrawRequestedAt { get; set; }
    public string Tier { get; set; } = "DEAD_INSIDE";
    public string Rate { get; set; } = "0";
}
public sealed class IndexerCheckpoint
{
    public string ProgramId { get; set; } = "";
    public string GenesisHash { get; set; } = "";
    public string Mint { get; set; } = "";
    public long StartSlot { get; set; }
    public long ThroughSlot { get; set; }
    public long ThroughTime { get; set; }
}
public sealed class AccountingDb(DbContextOptions<AccountingDb> options) : DbContext(options)
{
    public DbSet<PublishedCycleProjection> PublishedCycleProjections => Set<PublishedCycleProjection>();
    public DbSet<CycleProjectionCheckpoint> CycleProjectionCheckpoints => Set<CycleProjectionCheckpoint>();
    public DbSet<VerificationRecord> Verifications => Set<VerificationRecord>();
    public DbSet<OperatorEvent> OperatorEvents => Set<OperatorEvent>();
    public DbSet<CycleRecord> Cycles => Set<CycleRecord>();
    public DbSet<ChainEvent> Events => Set<ChainEvent>();
    public DbSet<MiningProjection> Projections => Set<MiningProjection>();
    public DbSet<IndexerCheckpoint> Checkpoints => Set<IndexerCheckpoint>();
    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<PublishedCycleProjection>().HasKey(e => e.CycleId);
        model.Entity<PublishedCycleProjection>().Property(e => e.CycleId).ValueGeneratedNever();
        model.Entity<CycleProjectionCheckpoint>().HasKey(e => e.ProgramId);
        model.Entity<VerificationRecord>().HasKey(e=>e.CycleId);
        model.Entity<OperatorEvent>().HasKey(e=>e.Id);
        model.Entity<OperatorEvent>().HasIndex(e=>e.Timestamp);
        model.Entity<ChainEvent>().HasKey(e => e.Id);
        model.Entity<ChainEvent>().HasIndex(e => new { e.Signature, e.EventIndex }).IsUnique();
        model.Entity<ChainEvent>().HasIndex(e => new { e.Slot, e.TransactionIndex, e.EventIndex }).IsUnique();
        model.Entity<ChainEvent>().HasIndex(e => e.Wallet);
        model.Entity<ChainEvent>().HasIndex(e => e.Position);
        model.Entity<MiningProjection>().HasKey(e => e.Wallet);
        model.Entity<MiningProjection>().HasIndex(e => e.Position).IsUnique();
        model.Entity<IndexerCheckpoint>().HasKey(e => e.ProgramId);
        model.Entity<CycleRecord>().HasKey(e => e.CycleId);
        model.Entity<CycleRecord>().HasIndex(e => e.StartTime).IsUnique();
        model.Entity<ChainEvent>().HasIndex(e => new { e.CycleId, e.Wallet });
        // All identifiers/large amounts are text; these SQL types are shared by
        // SQLite and PostgreSQL. No provider-specific identity/sequence columns.
        foreach (var entity in model.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                property.SetColumnType(property.ClrType == typeof(long) ? "bigint" : property.ClrType == typeof(int) ? "integer" : "text");
    }
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        if (ChangeTracker.Entries<ChainEvent>().Any(e => e.State is EntityState.Modified or EntityState.Deleted))
            throw new InvalidOperationException("Chain events are append-only");
        return base.SaveChangesAsync(cancellationToken);
    }
}
public sealed record HistoryBatch(string GenesisHash, string ProgramId, string Mint, long StartSlot, long ThroughSlot, long ThroughTime, ChainEvent[] Events);

public static class Projection
{
    public static void Apply(MiningProjection p, ChainEvent e)
    {
        if (e.BlockTime < 0 || e.Slot < 0) throw new InvalidOperationException("Negative chain time/slot");
        var locked = Points.Integer(p.Locked);
        var next = Points.Integer(e.EffectiveLockedAmount);
        var amount = Points.Integer(e.Amount);
        _ = Points.TierFor(next);
        if (amount < 0 || amount > ulong.MaxValue || p.Position != e.Position) throw new InvalidOperationException("Invalid event identity/amount");
        switch (e.EventType)
        {
            case "positionCreated":
                if (p.LastProcessedSlot != 0 || next != 0) throw new InvalidOperationException("Duplicate position creation");
                break;
            case "deposited":
                if (p.LastProcessedSlot == 0 || amount <= 0 || next != locked + amount) throw new InvalidOperationException("Deposit history mismatch");
                break;
            case "withdrawRequested":
                if (p.LastProcessedSlot == 0 || amount <= 0 || next != locked - amount || p.Pending != "0") throw new InvalidOperationException("Withdrawal history mismatch");
                p.Pending = e.Amount;
                p.WithdrawRequestedAt = e.BlockTime;
                break;
            case "withdrawExecuted":
                if (amount <= 0 || next != locked || amount != Points.Integer(p.Pending)) throw new InvalidOperationException("Execution history mismatch");
                p.Pending = "0";
                p.WithdrawRequestedAt = 0;
                break;
            default: throw new InvalidOperationException($"Unknown stake event {e.EventType}");
        }
        var time = Math.Max(p.LastAccrualTime, e.BlockTime);
        p.Units = (Points.Integer(p.Units) + Points.Accrue(Points.Integer(p.Rate), p.LastAccrualTime, time)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        p.LastAccrualTime = time;
        p.LastProcessedSlot = e.Slot;
        p.Locked = e.EffectiveLockedAmount;
        var tier = Points.TierFor(next);
        p.Tier = tier.Id;
        p.Rate = tier.RateUnits;
    }
}
