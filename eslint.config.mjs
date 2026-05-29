// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "*.config.*",
      "*.config.ts",
    ],
  },
  {
    rules: {
      // Allow underscore-prefixed args as intentionally unused (common in stubs)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow explicit any in stub files
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow require() in config files
      "@typescript-eslint/no-require-imports": "warn",
    },
  }
);
