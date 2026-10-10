# Android quickstart

To view the public demo, install [Android APK 0.13.3](https://yetanothermarket.cat/downloads/yet-another-cat-0.13.3.apk), use a Mobile Wallet Adapter wallet such as Solflare on devnet, and obtain free devnet SOL for fees. The application connects to the public backend; a local validator is not needed.

For source builds and emulator setup, see [build and run](docs/build-and-run.md#android). The existing signed APK can be installed with `adb install -r path/to/file.apk`. A locally generated signing key cannot upgrade an APK signed by a different key; do not uninstall a working setup just to resolve that mismatch.

`adb devices` lists authorized phones/emulators. Enable USB debugging and accept the authorization prompt on the phone. Android Studio's Device Manager starts an emulator; close it using its own close/stop action. Emulator background-window focus does not affect headless ADB commands.
