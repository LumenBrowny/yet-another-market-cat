# Current Android release

**Yet Another Market Cat 0.13.6 (28) · Solana devnet · 2026-10-11**

[Download APK](https://yetanothermarket.cat/downloads/yet-another-cat-0.13.6.apk) · [Source](https://github.com/LumenBrowny/yet-another-market-cat) · [Checksums and build metadata](https://yetanothermarket.cat/downloads/release.json)

Grounded tiers (×1, ×1.5 and ×2) now consistently face sideways on startup and after returning from faster tiers. Android SVG images retain their last decoded frame while a replacement PNG loads, avoiding a blank cat during sprite changes. The prior Yamc launcher icon and Unicode/layout repairs are retained.

The bitmap retention fix is applied reproducibly during Expo prebuild; it holds one previous image per SVG image view and releases it on replacement/detach. Review the guarded patch when upgrading react-native-svg.

This release retains the accepted CC0 Nine Lives loop, nine-tap entrance and explicit visual demo controls. Mining, stake, rewards, wallet flows and on-chain deployment are unchanged. Installing the signed update preserves application data and the connected wallet.

Package: `com.yetanothercat.app`. Signed release with demo controls enabled, not a debuggable build. The signing identity remains the same as the previous APK. Canonical file size, SHA-256 and signing certificate digest are in the linked release metadata; [deployment documentation](devnet-deployment.md) also records the APK checksum.

CATSHIT gameplay is devnet. SKR ownership is a separate read-only mainnet lookup for cosmetic access; it never spends or stakes SKR and does not change rewards. The deployment is publicly verifiable, not fully trustless: centralized publisher, upgradeable unaudited program and no on-chain fraud-proof challenge. RPC history availability can limit replay.

Code license is not selected. [Music provenance](../app/assets/room-skr-club/MUSIC-CREDITS.md) covers the CC0 club loop, not all bundled media. The last dependency review reported 48 npm advisories (19 moderate, 28 high, 1 critical); the critical `shell-quote` finding is in the React Native development-tool chain. This presentation update does not resolve those findings or constitute a security audit.

Product documentation stays in `docs/`. Recording scripts, submission drafts and detailed acceptance reports are local working material under the Git-ignored `local-notes/` directory.
