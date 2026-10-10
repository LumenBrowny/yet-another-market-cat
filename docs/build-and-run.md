# Build and run

## Prerequisites and checks

Use Node.js 24/npm, .NET SDK 10 and Rust stable with rustfmt. Install dependencies from the repository root:

```sh
npm ci
npm test
npm run typecheck
npm run lint
dotnet test server/YetAnotherCat.Tests -m:1
dotnet publish server/YetAnotherCat.Api -c Release -o dist/api -m:1
cargo fmt --all -- --check
cargo check --workspace
```

The lockfiles, migrations, protocol vectors, IDL and referenced artwork are committed. No private deployment files are required for these checks. Browser checks use `playwright-core` and an installed Microsoft Edge browser: `node scripts/test-release-web-014.cjs` previews local web files against the public read-only API; `node scripts/test-public-web.cjs` checks the hosted explorer. They require internet access and write ignored screenshots under `artifacts/`.

## Android

Windows release scripts require PowerShell 7, **JDK 17**, Android SDK platform 36, build-tools 36.0.0, platform-tools and the NDK/CMake versions selected by Expo/Gradle. Set `JAVA_HOME` and `ANDROID_HOME` to your installations. Run `npm ci` before building.

```powershell
./scripts/build-public-release.ps1 -Demo
```

This prebuilds native Android sources, bundles JS/assets, builds and verifies a signed release, then writes an APK and checksum metadata under `artifacts/`. Default services are the public devnet API and public Solana devnet RPC; `-ApiUrl` and `-RpcUrl` override them. Demo adds visual controls only. Omit `-Demo` for staging without those controls.

On a clean checkout the wrapper generates **your own** signing key and password file under ignored `.dev/`. Back them up privately if you intend to keep updating your build. A build signed with your key cannot update the official APK in place; use a separate test device or deliberately uninstall the existing app first (which clears its local settings). Never commit signing files. Install using `adb install -r path/to/your.apk` and launch Yet Another Market Cat. See [Android quickstart](../ANDROID-QUICKSTART.md).

For Metro development, copy `app/.env.example` to `app/.env`, set reachable API/RPC URLs and run `npm run android`. A physical phone needs a compatible MWA wallet. `EXPO_PUBLIC_*` values are embedded in the app and must never contain private credentials.

## Backend

The API serves the web UI directly from its committed `wwwroot`. Set environment variables explicitly; example files are templates, not automatically loaded by `dotnet`.

Minimal read-only devnet configuration in PowerShell:

```powershell
$env:SOLANA_PROGRAM_ID='BfNiASrYNqmARu2TQ1eBa1PJ6KgVHTNn44ATk5rJe6zW'
$env:SOLANA_START_SLOT='504431875'
$env:YAC_RPC_PRIMARY='https://api.devnet.solana.com'
$env:YAC_SETTLEMENT_ENABLED='false'
$env:YAC_PUBLISHER_ENABLED='false'
dotnet run --project server/YetAnotherCat.Api
```

SQLite state is created under ignored `.dev/`. Indexing the entire public deployment requires retained finalized history; the shared public RPC can rate-limit or lack older data. An empty local DB will not instantly reproduce the live explorer. For independent verification, see [verification](verification.md).

For a private deployment, adapt [backend.env.example](../infra/public/backend.env.example), [compose.yaml](../infra/public/compose.yaml) and the Caddy configuration. Supply your own operator token, database/storage credentials, archival primary/verification RPC endpoints and chain metadata. Leave publication disabled until history sync and independent verification pass. Never reuse example credentials. The generic CLI supports status, storage audit, verification and controlled catch-up; migrations are retained. Deploying or publishing is a separate operator action, not part of a build.

Copy `infra/public/.env.example` to `.env` in the same directory. Create its ignored `secrets/` directory and copy the backend, Postgres and storage `.env.example` templates there as `backend.env`, `postgres.env` and `storage.env`. Set matching database/storage credentials across those files. Mount your own `deployment.json` and `publisher.json` there as required by Compose. `docker compose config --quiet` validates configuration without starting services. `docker compose up -d --build` starts your separate deployment. The supplied systemd units/ops script assume installation under `/opt/yac`; adapt those paths for your host. Backups include private configuration and must remain private and be copied off-host.

## Local chain and program tests

Use Linux/WSL with Solana/Agave CLI and SBF tools, Anchor CLI **0.32.1**, Rust and Node installed in that environment. Use a **disposable clone** for a new local deployment: bootstrap creates a new program key and updates its source/IDL address.

```sh
npm ci
npm run bootstrap
bash scripts/build.sh
bash scripts/validator.sh
```

Keep the validator in its own terminal. In another terminal, create and fund your own local admin, then deploy and initialize:

```sh
mkdir -p .dev
solana-keygen new --no-bip39-passphrase -o .dev/admin.json
export ANCHOR_WALLET="$PWD/.dev/admin.json"
export RPC_URL=http://127.0.0.1:8899
solana airdrop 100 --url "$RPC_URL" --keypair "$ANCHOR_WALLET"
solana program deploy target/deploy/cat_shit_mining.so --url "$RPC_URL" --keypair "$ANCHOR_WALLET"
export YAC_SETTLEMENT_BOOTSTRAP=1
export YAC_DEPLOYMENT_FILE="$PWD/.dev/deployment.json"
export YAC_PUBLISHER_KEY="$PWD/.dev/publisher.json"
export YAC_CYCLE_DURATION=3600
npm run setup
npx tsx scripts/setup-rewards.ts
```

These operations create a separate local token/deployment. They must not be pointed at the public deployment. The rewards setup uses a one-day default unless `YAC_CYCLE_DURATION` is set explicitly as above. Backend `YAC_DEPLOYMENT_FILE` can read the resulting metadata.

For SBF/bankrun integration tests, build `target/deploy/cat_shit_mining.so` with `bash scripts/build-sbf.sh`, then run `bash scripts/test-program.sh`. Bankrun uses its own test context; live wallet approvals are a separate device check. CI covers JS/TS, .NET and host Rust checks; SBF requires the additional Solana toolchain.
