import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Separate config for real-Postgres DB integration tests (tests/db/**).
// These are NOT part of the `bun test:unit` merge gate — they require a live
// Postgres and run via `bun test:db`. In CI, provision Postgres and run this
// AFTER `bun db:migrate` so all migrations (incl. F1/F2/F7/F10) are applied.
// Locally, with no real DB, every suite self-skips (see tests/db/helpers.ts).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // No env override: use the real DATABASE_URL from the environment.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@db": resolve(__dirname, "./db"),
    },
  },
});
