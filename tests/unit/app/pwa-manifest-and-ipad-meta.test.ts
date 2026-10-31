// SEC-7 + iPad home screen — the manifest tells the truth (no loyalty/rewards:
// deleted in v7), works in any orientation, and the root layout carries the
// iOS/iPadOS home-screen meta. start_url stays /customer.
import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";
import { metadata, viewport } from "@/app/layout";

describe("manifest", () => {
  const m = manifest();

  it("has no rewards / loyalty copy", () => {
    expect(m.description).toBeDefined();
    expect(m.description!).not.toMatch(/reward|loyal|points|every visit counts/i);
  });

  it("uses the same true description as the site metadata", () => {
    expect(m.description).toBe(metadata.description);
  });

  it("orientation is 'any' and start_url stays /customer", () => {
    expect(m.orientation).toBe("any");
    expect(m.start_url).toBe("/customer");
  });
});

describe("root layout iPad home-screen meta", () => {
  it("declares an Apple web app with an opaque status bar", () => {
    expect(metadata.appleWebApp).toMatchObject({ capable: true, statusBarStyle: "black", title: "FAVO" });
  });

  it("emits the legacy apple-mobile-web-app-capable tag for older iPadOS", () => {
    expect(metadata.other).toMatchObject({ "apple-mobile-web-app-capable": "yes" });
  });

  it("viewport-fit=cover, and pinch-zoom is NOT disabled", () => {
    expect(viewport.viewportFit).toBe("cover");
    expect(viewport.userScalable).toBeUndefined();
    expect(viewport.maximumScale).toBeUndefined();
  });
});
