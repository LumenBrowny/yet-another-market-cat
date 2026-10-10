# Accounting, settlement and public API

See [architecture](../docs/architecture.md), [protocol](../docs/protocol.md), [verification](../docs/verification.md) and [build and run](../docs/build-and-run.md).

The .NET 10 backend supports PostgreSQL and SQLite with retained EF migrations. Node.js is required for independent TypeScript history/replay processes. Generic maintenance commands are implemented in `YetAnotherCat.Api/ProductCommands.cs`; chain/accounting semantics are covered by the test projects. Environment templates are in `infra/public/backend.env.example`.

The public UI is static HTML/CSS/JavaScript under `YetAnotherCat.Api/wwwroot`; English/Catalan text lives in its two locale modules. No frontend framework build is required.
