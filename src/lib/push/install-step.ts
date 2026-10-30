// REQ-048 / L29 / R16 — an iPhone or iPad only gets Web Push once FAVO is
// installed to the Home Screen. Until then the notification screens must state
// the install requirement and must never show a subscribed state.

/** True when the device is an iPhone/iPad/iPod (every iOS browser, not just Safari). */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ reports a desktop Safari UA; it is told apart by touch support.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/**
 * True when the install step must be shown: an iOS device whose page is not
 * running as an installed (standalone) app.
 */
export function shouldShowInstallStep(
  userAgent: string,
  isStandalone: boolean,
  maxTouchPoints = 0
): boolean {
  return isIosDevice(userAgent, maxTouchPoints) && !isStandalone;
}

/** Browser-side wrapper: reads the live navigator. Call only inside effects. */
export function detectInstallRequired(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    nav.standalone === true ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches);
  return shouldShowInstallStep(nav.userAgent, standalone, nav.maxTouchPoints ?? 0);
}

export const INSTALL_STEP_COPY = {
  heading: "Install FAVO to get notifications",
  steps:
    "On iPhone, notifications only work once FAVO is on your Home Screen. Tap the Share button in Safari, choose Add to Home Screen, then open FAVO from the new icon.",
} as const;
