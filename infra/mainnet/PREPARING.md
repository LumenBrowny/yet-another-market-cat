# Public mainnet, before activation

The preparing deployment is deliberately read-only. `compose.preparing.yaml`
does not mount publisher, issuer, admin, program or mint signing keys. Settlement,
publication and admission remain disabled; `YAC_READ_ONLY_STATE=true` supplies
chain lifecycle/reserve reads. `/api/health` reports `mode: read-only`, not publisher
readiness. Do not enable admission without a separate issuer service and consistent
admission DB backup; do not enable publication using this preparing profile.

## Paths and isolation

- Public site: `https://yetanothermarket.cat/`, source `web/mainnet/`, English/Català.
- Mainnet API base for future app: `https://yetanothermarket.cat/mainnet`.
- Existing `/api/*` and `/public/*` remain devnet for already installed applications.
- Devnet web archive: `/devnet/cycles`; existing downloads retained as devnet releases.
- Mainnet PostgreSQL database/user: `yamc_mainnet_accounting` / `yamc_mainnet`.
- Shared MinIO bucket, distinct prefix:
  `mainnet-GUyqmcRPYWxjdM3mXZDT89JAtxBtEWs31BNEKQ6KUT5H/`.
- VPS runtime: `/opt/yamc-mainnet`; existing proxy and PostgreSQL are reused.
- API private port: `127.0.0.1:5089`; no externally published database or storage port.

The mainnet image must contain the candidate IDL from `runtime-idl.json`, SHA256
`5e942a2cd13e1ca0769c426ac74240b7df077e644128a8f5a3309419926b35b0`.
The shared workspace's devnet IDL is not a valid mainnet runtime configuration.
Build the base API then apply `runtime.Dockerfile` with an explicitly supplied
`API_IMAGE`. Record and deploy its exact image ID through `YAMC_API_IMAGE`.

Do not reuse the ambiguous Docker service alias `api` in the shared network:
the proxy pins legacy backend to `yac-api-1`, mainnet to `yamc-mainnet-api`.

## Verification and rollback

Check mainnet `/mainnet/api/deployment`, `/mainnet/api/health`, `/mainnet/api/stats`
and `/mainnet/api/indexer/status`. Expected before scheduling: `PREPARED`, zero
published cycles, reserve `99000000000000`, correct mainnet genesis/program/mint.
Check `/api/explorer/config` still reports devnet; check both web explorers separately.
Mainnet publisher and admission must remain disabled regardless of site query params.

Site/config rollback copies are held locally on VPS under
`/opt/yamc-mainnet/rollback-20261111/`. Restore the old website/config from those
copies and validate/reload Caddy if needed; never restore an accounting database
over a running production database as part of a website rollback.

Encrypted backup export now includes a consistent mainnet PostgreSQL dump, runtime
configuration and website in addition to the existing devnet dump and manifest
mirror. Off-host pull uses the existing restricted SSH reader. Read-only API health
feeds the same monitoring channel. Admission DB is not present or covered yet.
Mainnet DB restore and future service-key recovery remain separate launch checks.

Public legal pages remain explicitly marked drafts, Store/APK links unavailable.
Finalize legal identity, Store package, mobile RPC, scoped production storage access,
service-key provisioning and activation review before opening distribution.
