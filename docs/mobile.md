# Mobile experience

The Android app uses React Native, Mobile Wallet Adapter, native sound/haptics and bundled PNG/WebP media. It is not a PWA/WebView wrapper. Cat Shit Engine uses deterministic fixed-step 2.5D pseudo-physics, collisions, thrust and squash/stretch. PP comes from finalized chain accounting; device animation or uptime cannot increase rewards.

## Current assets

The canonical chamber is defined by `app/src/chamber/exported-layout.ts` and its literal bundled PNG imports. Source pixels map to the 340 × 290 logical scene. Sprite and emission anchors live in `packages/cat-shit-engine/src/yamc-manifest.json`; purring anchors and open/closed mouth variants are separate. Selected sound timing/capacity is in `selected-audio.json` and the production controller.

Nine Lives keeps native animated transparent WebP cats, still images for suspension, the alternating banana PNG and the current PCM/WAV music loop. The SKR detector artwork sits behind the cat/particles; a stable invisible touch area handles the animation frames as one control.

The original room comparison and fallback textures remain because the shipped demo still references them. Their source artwork, cache manifests and two renderer scripts are required for existing tests/reproducibility. Only unreferenced exports, previews and rejected variants were pruned. Internal visual/audio editors are not build dependencies.

## SKR / Nine Lives

Read-only ownership detection uses the connected wallet’s real mainnet SKR balance. With positive eligibility, **9♥ / nine taps within four seconds** enters or exits Nine Lives. No SKR transaction is requested. This is cosmetic only; CATSHIT remains devnet and rewards are unchanged. Pause/background handling suspends animation and sound appropriately.

## Media and licensing

No license has yet been selected for original project code, and no blanket license is granted for bundled art/audio. The developer supplied the cat assets and confirmed permission to use them. The current Nine Lives loop combines two CC0 samples by Snapper4298. See [music attribution](../app/assets/room-skr-club/MUSIC-CREDITS.md) for source links and processing details. The public 0.13.4 APK and clean release source both use this loop.

Third-party library licenses remain with their respective packages. No existing attribution/license files were removed. This repository does not claim ownership of third-party meme characters or recordings.
