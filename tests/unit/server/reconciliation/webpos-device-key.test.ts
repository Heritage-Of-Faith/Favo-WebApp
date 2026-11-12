// The T10 reads repeat the card-machine config key instead of importing it from the tender
// runtime (job 9 reaches read.ts and no scheduled job may import the tender chain: REQ-066,
// DEC-29). This pins the two copies together.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(__dirname, "../../../../", p), "utf8");

function keyOf(file: string): string | undefined {
  return src(file).match(/const WEBPOS_DEVICE_KEY = "([^"]+)"/)?.[1];
}

describe("WEBPOS_DEVICE_KEY copies", () => {
  it("reconciliation/read.ts and tender/runtime.ts name the same app_config key", () => {
    const a = keyOf("src/server/reconciliation/read.ts");
    const b = keyOf("src/server/tender/runtime.ts");
    expect(a).toBe("webpos_device_id");
    expect(a).toBe(b);
  });

  it("read.ts does not import the tender runtime", () => {
    expect(src("src/server/reconciliation/read.ts")).not.toMatch(/@\/server\/tender\/runtime/);
  });
});
