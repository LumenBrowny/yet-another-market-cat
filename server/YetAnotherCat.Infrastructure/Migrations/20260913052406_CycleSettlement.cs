using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YetAnotherCat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CycleSettlement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CycleId",
                table: "Events",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "Cycles",
                columns: table => new
                {
                    CycleId = table.Column<string>(type: "text", nullable: false),
                    StartTime = table.Column<long>(type: "bigint", nullable: false),
                    EndTime = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ManifestJson = table.Column<string>(type: "text", nullable: false),
                    ManifestHash = table.Column<string>(type: "text", nullable: false),
                    Root = table.Column<string>(type: "text", nullable: false),
                    ProofsJson = table.Column<string>(type: "text", nullable: false),
                    PublicationSignature = table.Column<string>(type: "text", nullable: false),
                    PublishedSlot = table.Column<long>(type: "bigint", nullable: false),
                    Address = table.Column<string>(type: "text", nullable: false),
                    InputThroughSlot = table.Column<long>(type: "bigint", nullable: false),
                    InputHash = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Cycles", x => x.CycleId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Events_CycleId_Wallet",
                table: "Events",
                columns: new[] { "CycleId", "Wallet" });

            migrationBuilder.CreateIndex(
                name: "IX_Cycles_StartTime",
                table: "Cycles",
                column: "StartTime",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Cycles");

            migrationBuilder.DropIndex(
                name: "IX_Events_CycleId_Wallet",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "CycleId",
                table: "Events");
        }
    }
}
