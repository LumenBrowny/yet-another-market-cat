using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YetAnotherCat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class IncrementalCycleProjection008 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CycleProjectionCheckpoints",
                columns: table => new
                {
                    ProgramId = table.Column<string>(type: "text", nullable: false),
                    GenesisHash = table.Column<string>(type: "text", nullable: false),
                    Mint = table.Column<string>(type: "text", nullable: false),
                    NextCycle = table.Column<long>(type: "bigint", nullable: false),
                    AuditedAt = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CycleProjectionCheckpoints", x => x.ProgramId);
                });

            migrationBuilder.CreateTable(
                name: "PublishedCycleProjections",
                columns: table => new
                {
                    CycleId = table.Column<long>(type: "bigint", nullable: false),
                    ImmutableJson = table.Column<string>(type: "text", nullable: false),
                    Hash = table.Column<string>(type: "text", nullable: false),
                    AuditedClaimedAmount = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublishedCycleProjections", x => x.CycleId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CycleProjectionCheckpoints");

            migrationBuilder.DropTable(
                name: "PublishedCycleProjections");
        }
    }
}
