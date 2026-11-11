module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_BUILD_PROFILE === "mainnet") {
    if (process.env.EXPO_PUBLIC_REHEARSAL_GENESIS || process.env.EXPO_PUBLIC_ADMISSION_LAB === "true")
      throw new Error("Mainnet excludes lab/rehearsal");
    return { ...config, name: "Yet Another Market Cat", slug: "yet-another-market-cat",
      version: "1.0.2", scheme: "yamc-mainnet",
      android: { ...config.android, package: "cat.yetanothermarket.app", versionCode: 3 } };
  }
  if (process.env.EXPO_PUBLIC_REHEARSAL_GENESIS) {
    if (
      process.env.EXPO_PUBLIC_BUILD_PROFILE !== "local" ||
      process.env.EXPO_PUBLIC_ADMISSION_LAB === "true"
    )
      throw new Error("Main-app rehearsal requires isolated local profile");
    return {
      ...config,
      name: "YAMC Local Rehearsal",
      slug: "yamc-rehearsal",
      scheme: "yamc-rehearsal",
      android: { ...config.android, package: "com.yetanothercat.rehearsal" },
    };
  }
  if (process.env.EXPO_PUBLIC_ADMISSION_LAB !== "true") return config;
  if (process.env.EXPO_PUBLIC_BUILD_PROFILE !== "local")
    throw new Error("Admission Lab is local-only");
  return {
    ...config,
    name: "YAMC Admission Lab",
    slug: "yamc-admission-lab",
    scheme: "yamc-admission-lab",
    android: { ...config.android, package: "com.yetanothercat.admissionlab" },
  };
};
