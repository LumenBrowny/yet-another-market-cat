# Android release status

## Mainnet candidate — not publicly released

**1.0.2 (3)** · `cat.yetanothermarket.app` · PRE-LAUNCH, separate package and signing identity from devnet. Wallet connection and waiting state were exercised on physical devices. No activation date is set; no public download or Solana dApp Store listing is announced.

APK SHA256: `d4f6d7873bd95e78ceb6d632368dfac325b614778b1e1a8f49b791b1b45fb5fe`.

Signing certificate SHA256: `c0a9a3151711f3db0eee449c7dd720c85375b4abe0ce4bf698407564c2f0ac5d`.

Mainnet excludes demo/rehearsal controls and uses a restricted public mobile RPC gateway. Admission is not open. Candidate testing is not a claim that live mainnet faucet/lock/claim has been exercised. See [mainnet status](mainnet-deployment.md).

## Historical public devnet release

**Yet Another Market Cat 0.13.7 (29) · Solana devnet · 2026-10-12**

[Download APK](https://yetanothermarket.cat/downloads/yet-another-cat-0.13.7.apk) · [Source](https://github.com/LumenBrowny/yet-another-market-cat) · [Checksums and build metadata](https://yetanothermarket.cat/downloads/release.json)

Wallet approval screens now receive the full **Yet Another Market Cat** name, site URI and icon. The HTTPS domain association matches the existing signing certificate. This display was accepted in Solflare on a physical phone.

DEMO / PHYSICS exposes only ROOM IDLE, ROOM NOTICE, ROOM PANIC and ROOM DISASTER. Closing the panel restores the chain tier. Preview does not alter stake, points or rewards. SOUND and HAPTICS remain outside the panel.

This release retains the grounded sideways poses, decoded-image retention fix, Yamc launcher icon, CC0 Nine Lives loop and nine-tap entrance. Mining, rewards and the on-chain deployment are unchanged. Installing the signed update preserves app data; wallet identity changes can request fresh authorization.

Package: `com.yetanothercat.app`. Signed release with demo controls enabled, not a debuggable build. The signing identity remains the same as the previous APK. Canonical file size, SHA-256 and signing certificate digest are in the linked release metadata; [deployment documentation](devnet-deployment.md) also records the APK checksum.

CATSHIT gameplay is devnet. SKR ownership is a separate read-only mainnet lookup for cosmetic access; it never spends or stakes SKR and does not change rewards. The deployment is publicly verifiable, not fully trustless: centralized publisher, upgradeable unaudited program and no on-chain fraud-proof challenge. RPC history availability can limit replay.

Code license is not selected. [Music provenance](../app/assets/room-skr-club/MUSIC-CREDITS.md) covers the CC0 club loop, not all bundled media. The 2026-10-12 dependency review reported 48 npm advisories (19 moderate, 28 high, 1 critical); the critical `shell-quote` finding is in the React Native development-tool chain. These findings remain open; see the [scoped security review](security-review.md) for evidence and limitations. This is not an external audit or a production-security claim.

Product documentation stays in `docs/`. Recording scripts, submission drafts and detailed acceptance reports are local working material under the Git-ignored `local-notes/` directory.
