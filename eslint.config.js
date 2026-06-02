import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        OfflineStore: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-control-regex": "off",
      "prefer-const": "warn",
    },
  },
  {
    ignores: ["pdf.min.js", "pdf.worker.min.js", "xlsx.full.min.js", "node_modules/**"],
  },
];
