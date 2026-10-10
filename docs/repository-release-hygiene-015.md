# Release source hygiene

The release repository contains the current product, build inputs and tests. It starts from a clean source snapshot; the private development archive is separate. No deployment keys, APK binaries, local databases or generated acceptance recordings are included.

## Scope and size

367 obsolete tracked files were removed from the development tree: three internal labs and their experimental media (107 files), lab-only tests (4), unused app assets/exports/previews (172), one-off scripts (45), historical documents (32), an internal handoff, an editor-only scene export, superseded website media (2), and incident-specific operational scripts (3).

| Area             |               Before |              Release tree |
| ---------------- | -------------------: | ------------------------: |
| Tracked source   | 787 files / 117.0 MB | about 431 files / 52.5 MB |
| Documentation    |    33 files / 252 KB |       8 concise documents |
| Internal labs    |  107 files / 37.6 MB |                   removed |
| App assets       |  399 files / 73.2 MB |       228 files / 50.7 MB |
| Reusable scripts |                   68 |                        23 |
| Website media    |    5 files / 4.24 MB |         3 files / 0.26 MB |

Sizes describe source content, not installed dependencies or the private archive's Git history. Four retained files exceed 1 MiB (club background, two selected sounds, club loop); none exceeds 5 MiB. Runtime artwork is unchanged except for the explicitly requested CC0 music replacement. Referenced comparison rooms, renderer source art/cache manifests, all schema migrations, protocol vectors, independent verifier, block-cache checks and generic maintenance commands remain.

## Validation

A separate source-only checkout was populated without ignored files, previous build products, local keys or private art. Dependencies were installed afresh.

- `npm ci`, 90 JS/TS tests, typecheck and lint passed.
- .NET: 63 tests passed; the Postgres integration test (no test database configured) and process-tree timeout test (Windows-specific skip) were skipped locally. API Release publish passed.
- Rust format/check and two host tests passed. SBF/bankrun tests require the additional Solana toolchain and were not rerun for this source/media cleanup; program and protocol logic were unchanged.
- Android 0.13.4 (26) built from the clean checkout using a newly generated local signing identity. The APK was then signed with the maintainer's existing key for a physical-device update. Room, SKR/Nine Lives, repeated music and SOUND ON/OFF were checked. All 178 runtime media references matched packaged content; five renderer-only source images correctly remain outside the runtime bundle.
- Public website/explorer/verifier checks passed on 12 EN/CA routes. The local landing page passed four viewport sizes per language and API/metadata outage checks. Public APK, health and manifest endpoints remained available.
- Gitleaks 8.30.1 and additional source heuristics found no credentials in the release source. A public wallet label in an old document and a deliberately invalid credential URL in a rejection test were classified as false positives. Relative documentation links and asset references resolved.
- GitHub Actions validates the actual product; the checked development snapshot passed before export. See the release repository's Actions page for current runs.

## Known limits

Original code has no selected open-source license. Bundled media is not covered by a blanket license; [music provenance](../app/assets/room-skr-club/MUSIC-CREDITS.md) records the new CC0 loop. Supplied meme-cat assets remain unchanged.

An online npm audit reported 48 existing dependency advisories (19 moderate, 28 high, 1 critical). The critical `shell-quote` finding is in the React Native development-tool dependency chain. This is not a full security review or a claim that every advisory is unreachable. Dependency modernization is a separate task; no forced upgrades were applied.

The website and release source now distribute 0.13.4; see [release notes](release-0.13.4.md). Publisher, economics, on-chain program and verification trust model were not changed. The source-cleanliness check does not imply a production security audit or mainnet readiness.
