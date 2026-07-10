import type { Page } from "@playwright/test";

// ─── Touch-target & interactivity audit — AT-138 ──────────────────────────────
//
// Two checks, run against the real rendered DOM (not jsdom — bounding boxes
// need actual layout):
//
//   1. Size: every visible interactive control must be at least 44×44 CSS px
//      (Apple HIG "Human Interface Guidelines" minimum tap target / WCAG 2.5.8
//      Target Size (Minimum)).
//   2. Spacing: no two DIFFERENT controls may have hit-area centers closer
//      than 48px apart — the standard 24px-radius "non-intersecting circle"
//      heuristic (two 24px-radius circles centered on each target's center
//      must not overlap, i.e. centers ≥ 24+24 = 48px apart). This catches
//      controls that individually pass the size check but are crammed close
//      enough that a real fingertip reliably mis-hits its neighbour.
//
// "Interactive" = anything a user can tap to do something: buttons, links,
// inputs, and explicit role=button/link/checkbox/radio/switch/tab elements.
// Elements with zero area (display:none, 0×0, off-screen) are excluded — they
// aren't tappable at all, so they're not a hit-area risk.

export const MIN_TARGET_PX = 44;
export const MIN_CENTER_DISTANCE_PX = 48; // 24px + 24px radii

export type TargetBox = {
  /** Human-readable locator hint for debugging — not a re-queryable selector. */
  hint: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type SizeViolation = {
  kind: "size";
  target: TargetBox;
  message: string;
};

export type SpacingViolation = {
  kind: "spacing";
  a: TargetBox;
  b: TargetBox;
  distance: number;
  message: string;
};

export type Violation = SizeViolation | SpacingViolation;

// Next.js's dev-mode overlay (route-change indicator, dev tools popover) injects
// its own interactive controls into every page in local/dev builds. It's
// framework chrome that never ships to production and isn't part of the FAVO
// product surface, so it's excluded by accessible-name rather than treated as
// a real finding.
const DEV_TOOLING_LABEL_RE = /next\.js dev tools|next\.js route/i;

const INTERACTIVE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([type=hidden]):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
].join(", ");

function labelFor(el: {
  ariaLabel: string | null;
  text: string;
  tag: string;
  type: string | null;
}): string {
  const raw = el.ariaLabel || el.text.trim().slice(0, 40) || `<${el.tag}${el.type ? ` type=${el.type}` : ""}>`;
  return raw.replace(/\s+/g, " ");
}

/**
 * Collects every visible interactive element's bounding box on the current
 * page. Elements with zero rendered area are skipped (not real hit-area risks).
 */
export async function collectTargets(page: Page): Promise<TargetBox[]> {
  const raw = await page.$$eval(INTERACTIVE_SELECTOR, (els) =>
    els.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) !== 0;
      return {
        i,
        visible,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        ariaLabel: el.getAttribute("aria-label"),
        text: (el as HTMLElement).innerText ?? "",
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
      };
    })
  );

  return raw
    .filter((e) => e.visible)
    .filter((e) => !DEV_TOOLING_LABEL_RE.test(e.ariaLabel ?? ""))
    .map((e) => ({
      hint: `${e.tag}${e.type ? `[type=${e.type}]` : ""} (#${e.i + 1} of ${raw.length} interactive elements)`,
      label: labelFor(e),
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      centerX: e.x + e.width / 2,
      centerY: e.y + e.height / 2,
    }));
}

/** Runs both checks against the current page's rendered interactive elements. */
export async function auditTouchTargets(page: Page): Promise<Violation[]> {
  const targets = await collectTargets(page);
  const violations: Violation[] = [];

  for (const t of targets) {
    if (t.width < MIN_TARGET_PX || t.height < MIN_TARGET_PX) {
      violations.push({
        kind: "size",
        target: t,
        message: `"${t.label}" is ${Math.round(t.width)}×${Math.round(t.height)}px — below the ${MIN_TARGET_PX}×${MIN_TARGET_PX}px minimum.`,
      });
    }
  }

  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      // Skip pairs whose boxes are nested/identical (e.g. an icon inside its
      // own button both matching the selector) — same control, not a spacing risk.
      const nested =
        a.x <= b.x && a.y <= b.y &&
        a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
      const nestedReverse =
        b.x <= a.x && b.y <= a.y &&
        b.x + b.width >= a.x + a.width && b.y + b.height >= a.y + a.height;
      if (nested || nestedReverse) continue;

      const dx = a.centerX - b.centerX;
      const dy = a.centerY - b.centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < MIN_CENTER_DISTANCE_PX) {
        violations.push({
          kind: "spacing",
          a, b, distance,
          message: `"${a.label}" and "${b.label}" hit-area centers are ${Math.round(distance)}px apart — below the ${MIN_CENTER_DISTANCE_PX}px (24px-radius non-intersecting circle) minimum.`,
        });
      }
    }
  }

  return violations;
}

/** Formats violations as a readable multi-line block for assertion messages. */
export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `  - ${v.message}`).join("\n");
}
