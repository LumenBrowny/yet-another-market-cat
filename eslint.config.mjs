import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "node_modules/**",
      "target/**",
      "app/android/**",
      "app/ios/**",
      "dist/**",
      ".dev/**",
      "temp/**",
      "local-notes/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["server/**/wwwroot/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        URLSearchParams: "readonly",
        URL: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        document: "readonly",
        innerWidth: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        performance: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
