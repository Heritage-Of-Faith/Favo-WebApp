// Vitest global setup — runs before all tests
import "@testing-library/jest-dom/vitest";

// jsdom lacks ResizeObserver, which the bespoke SVG charts (N7) use to track
// their container width. Provide a no-op polyfill so chart components render in
// tests (they fall back to their default width).
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
