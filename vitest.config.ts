import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // Dummy DB URL so modules importing the (lazy) Drizzle client load without a real DB.
    // Unit tests never open a connection — they assert on pure data and logic.
    //
    // YOCO_SECRET_KEY is forced empty so transitionOrder's cash-remove payment
    // gate (AT-122) stays in its "Yoco not configured" bypass branch during
    // tests, regardless of whatever placeholder value a developer's local
    // .env.local defines — Vite auto-loads .env.local into process.env, and
    // without this override that placeholder makes the gate active and tests
    // that don't mock a `payments` row (earn-scenarios, loyalty-history) fail
    // with PAYMENT_REQUIRED on any machine that has a real .env.local.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/favo_test",
      YOCO_SECRET_KEY: "",
    },
    coverage: {
      reporter: ["text", "lcov"],
    },
    server: {
      deps: {
        // Inline these so Vite's resolver (which honours package `exports`
        // maps) handles them. next-auth/@auth/core import "next/server" via
        // next's exports map; left externalised, Node's raw ESM resolver
        // treats it as a missing file path and any suite that transitively
        // loads the NextAuth root config fails to load (e.g. operating-hours).
        inline: ["zod", "next-auth", "@auth/core"],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@db": resolve(__dirname, "./db"),
    },
  },
});
