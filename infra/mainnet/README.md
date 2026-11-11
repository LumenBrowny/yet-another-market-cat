# Mainnet release preparation

`release-profile.template.json` is a **read-only review document**, not an environment
file, deployment command, signing policy, or approval. Do not feed it into the
devnet setup scripts. Existing local-only signing/deployment guards remain intact.

Copy the template into an ignored local-notes directory for review. Keep RPC tokens,
private keys, passwords and other secrets out of it; record only public addresses,
artifact hashes, image digests, isolated resource names and evidence references.

```powershell
npx tsx scripts/release/check-mainnet-profile.ts
# Or pass the path to a locally filled copy as the final argument.
```

The blank template exits nonzero with `BLOCKED_INCOMPLETE`. Invalid economics,
automatic-execution flags, known rehearsal identities, role collisions, malformed
pins and unordered dates are rejected. A profile with complete fields still reports
`COMPLETE_FIELDS_REQUIRE_MANUAL_EVIDENCE_REVIEW`: this tool does not authenticate
reports, check the network, verify binaries, sign, deploy or activate anything.

The template describes eventual **public launch readiness**, not a requirement
to have a Store listing or active schedule before preparing/deploying an inactive
program. Deployment, initial funding, Store publication and scheduling are separate
review stages. Keep schedule null until its dedicated activation review.

Preferred deployment procedure rehearsed locally:

1. Upload ELF to a buffer with a separate payer/upload key.
2. Offline admin accepts buffer authority using checked transfer + durable nonce.
3. Re-read and independently verify finalized buffer ELF and authority.
4. Offline admin signs direct deployment; payer and Program key add their signatures.
5. Verify executable/ProgramData/ELF and initial offline authority before initialization.
6. Initialize fixed supply, fund rewards, then separately schedule launch when ready.

The existing local program ID is deliberately forbidden in a production profile.
Choosing a fresh program ID requires updating declare_id/IDL/client configuration,
rebuilding and repeating release checks. Hashes of the current rehearsal candidate
are not final mainnet hashes. Changing upgrade authority later does not change
Config admin; initialization currently requires them to coincide.

## Local SBF reproducibility evidence

From WSL with the existing Solana/Anchor tools installed:

```bash
python3 scripts/release/reproduce-sbf.py
```

For a candidate using newly verified offline public identities:

```bash
python3 scripts/release/reproduce-sbf.py --identity-file temp/mainnet-identities-return/public-identities.json
```

This verifies custody proofs with Node, then changes the program ID only in the
isolated source snapshot (`declare_id` and Anchor mappings). It does not change
working devnet/client settings. Matching the previous rehearsal ELF is no longer
expected; both new clean builds must match, and the workspace must stay unchanged.
Fresh candidate IDL/client configuration and runtime acceptance remain separate
checks before deployment. On WSL, installed Windows Node can verify public proofs.

This creates an allowlisted source snapshot and two separate clean build directories
under `.dev/sbf-repro-*`, uses locked/offline dependencies, pins SBF architecture v0
and platform-tools v1.52, and records hashes/tool versions. It does not replace the
working `target/deploy` ELF or copy private keys. Output directories may contain
automatically generated **test** program keypairs from build tooling; do not package
whole build directories or reuse those keys for production. Package only explicit
public source/ELF/IDL/report files.

The helper expects cargo-build-sbf 3.1.10 / SBF Rust 1.89.0 and local Anchor at
`.dev/anchor/bin/anchor`. It uses the existing dependency/tool cache; it is not a
hermetic container build. Same-machine matching builds do not establish independent
source verification. CI's moving runner/host toolchain and application/container/APK
release artifacts require their own review and pins.

## Candidate runtime and container acceptance

Run the SBF custody, settlement and lifecycle tests against an isolated copy of
the candidate ELF and freshly generated IDL. All client imports must resolve to
that copy; otherwise a successful test could exercise the previous program ID.
Use disposable test admin/mint keys. Bankrun executes the actual SBF program with
test loader metadata, but does not test RPC transport or a real loader deployment.
Never request production-key signatures for these runtime fixtures.

`repro.Dockerfile` prepares a separate Ubuntu build environment. Pin the resulting
image ID in the report as well as the base digest: apt package versions may change
on later image builds. Compile with networking disabled, a fresh target directory,
the exact source snapshot and Cargo.lock, and read-only compiler/dependency inputs.
Keep writable Cargo/target directories on Linux volumes when using Docker Desktop;
Windows bind mounts do not preserve all Unix metadata. Record any capability needed
to read owner-only public cache files. No home directory or credential directory
should be mounted wholesale.

A container rebuild using the same compiler and dependency cache is cross-environment
reproducibility, **not independent third-party verification**. Before calling a
release independently verified, arrange another trusted environment/operator with
independently obtained, checked toolchain inputs and compare the exact ELF hash.
Do not mark that evidence complete based on this Docker check alone.
