const {
  withAppBuildGradle,
  withAndroidManifest,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = (config) => {
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      // Upstream 2.x logs auth_token and transaction payloads even in release builds.
      // Keep diagnostics, remove request parameters reproducibly after npm ci / prebuild.
      const file = path.resolve(
        c.modRequest.projectRoot,
        "../node_modules/@solana-mobile/mobile-wallet-adapter-protocol/android/src/main/java/com/solanamobile/mobilewalletadapter/reactnative/SolanaMobileWalletAdapterModule.kt",
      );
      const source = await fs.readFile(file, "utf8");
      if (!source.includes("class SolanaMobileWalletAdapterModule"))
        throw new Error(
          "MWA logging patch requires review after dependency update",
        );
      await fs.writeFile(
        file,
        source
          .replaceAll(" with params $params", "")
          .replaceAll("startSession with config $config", "startSession"),
        "utf8",
      );
      return c;
    },
  ]);
  config = withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$["android:usesCleartextTraffic"] =
      process.env.EXPO_PUBLIC_BUILD_PROFILE === "local" ? "true" : "false";
    return c;
  });
  return withAppBuildGradle(config, (c) => {
    let s = c.modResults.contents;
    if (!s.includes("// YAC release signing")) {
      s = s.replace(
        "    signingConfigs {",
        `    signingConfigs {
        // YAC release signing: key and passwords are provided only during the build.
        release {
            if (System.getenv('YAC_ANDROID_KEYSTORE')) {
                storeFile file(System.getenv('YAC_ANDROID_KEYSTORE'))
                storePassword System.getenv('YAC_ANDROID_STORE_PASSWORD')
                keyAlias System.getenv('YAC_ANDROID_KEY_ALIAS')
                keyPassword System.getenv('YAC_ANDROID_KEY_PASSWORD')
            }
        }`,
      );
      const release = s.indexOf(
        "        release {",
        s.indexOf("    buildTypes {"),
      );
      s =
        s.slice(0, release) +
        s
          .slice(release)
          .replace(
            "signingConfig signingConfigs.debug",
            "signingConfig signingConfigs.release",
          );
    }
    if (!s.includes("// YAC bundle configuration inputs"))
      s += `
// YAC bundle configuration inputs: Gradle must not reuse a bundle from another profile.
tasks.matching { it.name == 'createBundleReleaseJsAndAssets' }.configureEach {
    ['EXPO_PUBLIC_BUILD_PROFILE','EXPO_PUBLIC_CLUSTER','EXPO_PUBLIC_API_URL','EXPO_PUBLIC_RPC_URL','EXPO_PUBLIC_DEMO_CONTROLS','EXPO_PUBLIC_APP_IDENTITY'].each { key ->
        inputs.property(key, System.getenv(key) ?: '')
    }
}
`;
    c.modResults.contents = s;
    return c;
  });
};
