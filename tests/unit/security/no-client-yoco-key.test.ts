// REQ-071 (L40, §9.10.2): a production build contains no Yoco key of any kind
// in the client bundle. Next.js inlines every NEXT_PUBLIC_* reference into the
// browser bundle, so no source file may reference one for Yoco, no file may
// carry a Yoco public-key literal, and nothing may load the client-side Yoco
// card SDK (which only works with a public key in the browser).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

function hits(re: RegExp, files: string[]): string[] {
  return files
    .filter((f) => re.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
}

// Build and deploy inputs can inline a NEXT_PUBLIC_ value into the bundle too
// (Docker build args, workflow env, compose files), so they are scanned as well.
function deployFiles(): string[] {
  const out = [join(ROOT, "Dockerfile"), join(ROOT, "docker-entrypoint.sh")];
  for (const dir of [join(ROOT, ".github", "workflows"), join(ROOT, "infra")]) {
    try {
      for (const name of readdirSync(dir, { recursive: true }) as string[]) {
        if (/\.(ya?ml|sh)$/.test(name)) out.push(join(dir, name));
      }
    } catch { /* directory absent */ }
  }
  return out;
}

const SOURCES = [
  ...walk(SRC),
  join(ROOT, "next.config.ts"),
  join(ROOT, "proxy.ts"),
  ...deployFiles(),
].filter((f) => {
  try { return statSync(f).isFile(); } catch { return false; }
});

describe("REQ-071 — no Yoco key of any kind client-side", () => {
  it("no source file references a NEXT_PUBLIC_ Yoco variable", () => {
    expect(hits(/NEXT_PUBLIC_YOCO/, SOURCES)).toEqual([]);
  });

  it("no source file carries a Yoco public-key literal (pk_test_ / pk_live_)", () => {
    expect(hits(/\bpk_(test|live)_[A-Za-z0-9]/, SOURCES)).toEqual([]);
  });

  it("nothing loads the client-side Yoco card SDK", () => {
    expect(hits(/js\.yoco\.com|YocoSDK/, SOURCES)).toEqual([]);
  });
});
