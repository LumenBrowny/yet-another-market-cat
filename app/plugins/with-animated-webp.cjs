const { withGradleProperties } = require("@expo/config-plugins");
module.exports = (config) =>
  withGradleProperties(config, (c) => {
    for (const key of ["expo.webp.enabled", "expo.webp.animated"]) {
      c.modResults = c.modResults.filter((p) => p.key !== key);
      c.modResults.push({ type: "property", key, value: "true" });
    }
    return c;
  });
