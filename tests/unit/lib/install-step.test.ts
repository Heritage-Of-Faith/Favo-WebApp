// REQ-048 / L29 / R16 — pure install-step decision.
import { describe, it, expect } from "vitest";
import { shouldShowInstallStep } from "@/lib/push/install-step";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC_SAFARI = IPADOS_DESKTOP_UA;

describe("shouldShowInstallStep", () => {
  it("is true for an iPhone in Safari that is not installed", () => {
    expect(shouldShowInstallStep(IPHONE_SAFARI, false)).toBe(true);
  });
  it("is true for an iPad that is not installed", () => {
    expect(shouldShowInstallStep(IPAD_SAFARI, false)).toBe(true);
  });
  it("is true for iPadOS that reports a desktop UA but has touch", () => {
    expect(shouldShowInstallStep(IPADOS_DESKTOP_UA, false, 5)).toBe(true);
  });
  it("is false once the iPhone runs as an installed app", () => {
    expect(shouldShowInstallStep(IPHONE_SAFARI, true)).toBe(false);
  });
  it("is false on Android and on a real Mac", () => {
    expect(shouldShowInstallStep(ANDROID_CHROME, false)).toBe(false);
    expect(shouldShowInstallStep(MAC_SAFARI, false, 0)).toBe(false);
  });
});
