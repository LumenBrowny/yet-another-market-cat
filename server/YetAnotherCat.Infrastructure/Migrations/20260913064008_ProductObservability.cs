using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace YetAnotherCat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ProductObservability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OperatorEvents",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    Timestamp = table.Column<long>(type: "bigint", nullable: false),
                    Severity = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    CycleId = table.Column<string>(type: "text", nullable: false),
                    Message = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OperatorEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Verifications",
                columns: table => new
                {
                    CycleId = table.Column<string>(type: "text", nullable: false),
                    ManifestHash = table.Column<string>(type: "text", nullable: false),
                    Root = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    VerifiedAt = table.Column<long>(type: "bigint", nullable: false),
                    ReportJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Verifications", x => x.CycleId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OperatorEvents_Timestamp",
                table: "OperatorEvents",
                column: "Timestamp");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OperatorEvents");

            migrationBuilder.DropTable(
                name: "Verifications");
        }
    }
}
