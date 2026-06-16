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
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/favo_test",
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
