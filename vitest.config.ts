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
    // YOCO_SECRET_KEY is forced empty so no test picks up a placeholder from a
    // developer's .env.local (Vite auto-loads it into process.env). The
    // payment gate on transitionOrder no longer reads this key at all (PRD
    // DEC-26, 9 Nov 2026): it is on in every mode, key set or not.
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
