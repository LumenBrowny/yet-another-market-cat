using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YetAnotherCat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialAccounting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Checkpoints",
                columns: table => new
                {
                    ProgramId = table.Column<string>(type: "text", nullable: false),
                    GenesisHash = table.Column<string>(type: "text", nullable: false),
                    Mint = table.Column<string>(type: "text", nullable: false),
                    StartSlot = table.Column<long>(type: "bigint", nullable: false),
                    ThroughSlot = table.Column<long>(type: "bigint", nullable: false),
                    ThroughTime = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Checkpoints", x => x.ProgramId);
                });

            migrationBuilder.CreateTable(
                name: "Events",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Signature = table.Column<string>(type: "text", nullable: false),
                    Slot = table.Column<long>(type: "bigint", nullable: false),
                    TransactionIndex = table.Column<int>(type: "integer", nullable: false),
                    EventIndex = table.Column<int>(type: "integer", nullable: false),
                    BlockTime = table.Column<long>(type: "bigint", nullable: false),
                    EventType = table.Column<string>(type: "text", nullable: false),
                    Wallet = table.Column<string>(type: "text", nullable: false),
                    Position = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<string>(type: "text", nullable: false),
                    EffectiveLockedAmount = table.Column<string>(type: "text", nullable: false),
                    RawPayload = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Projections",
                columns: table => new
                {
                    Wallet = table.Column<string>(type: "text", nullable: false),
                    Position = table.Column<string>(type: "text", nullable: false),
                    Locked = table.Column<string>(type: "text", nullable: false),
                    Units = table.Column<string>(type: "text", nullable: false),
                    LastAccrualTime = table.Column<long>(type: "bigint", nullable: false),
                    LastProcessedSlot = table.Column<long>(type: "bigint", nullable: false),
                    Pending = table.Column<string>(type: "text", nullable: false),
                    WithdrawRequestedAt = table.Column<long>(type: "bigint", nullable: false),
                    Tier = table.Column<string>(type: "text", nullable: false),
                    Rate = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Projections", x => x.Wallet);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Events_Position",
                table: "Events",
                column: "Position");

            migrationBuilder.CreateIndex(
                name: "IX_Events_Signature_EventIndex",
                table: "Events",
                columns: new[] { "Signature", "EventIndex" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Events_Slot_TransactionIndex_EventIndex",
                table: "Events",
                columns: new[] { "Slot", "TransactionIndex", "EventIndex" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Events_Wallet",
                table: "Events",
                column: "Wallet");

            migrationBuilder.CreateIndex(
                name: "IX_Projections_Position",
                table: "Projections",
                column: "Position",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Checkpoints");

            migrationBuilder.DropTable(
                name: "Events");

            migrationBuilder.DropTable(
                name: "Projections");
        }
    }
}
