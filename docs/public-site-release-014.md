# Public site and release

The public website offers full English/Catalan explanations, a direct signed Android APK, live devnet snapshots, cycle explorer, wallet inspector and cached independent verifier reports.

Current documentation: [architecture](architecture.md), [protocol](protocol.md), [verification](verification.md), [canonical devnet / APK](devnet-deployment.md), [build and run](build-and-run.md), [mobile](mobile.md).

This stable path is retained because the deployed website links here. It contains current documentation rather than the former development handoff.

The page renders static product/download content before reading APIs. Status uses `/api/cycles`, `/api/stats`, `/api/health`, the latest explorer record and its cached verification report, once per visit/manual refresh. It does not poll or launch replay. Unavailable/stale data is labelled; vault balance includes committed unclaimed rewards and is distinct from uncommitted reserve. Publisher enablement is not exposed by the public API. Latest verified is shown only when the latest publication has a complete VALID report.

The site has no framework build step: static modules are in `server/YetAnotherCat.Api/wwwroot`. Caddy serves the directory and a separate release-download directory. Private credentials, database backups and operator data never belong in either public directory. The source link points to the public release repository. `infra/public/release.json` is the canonical safe download metadata deployed as `/downloads/release.json`.
