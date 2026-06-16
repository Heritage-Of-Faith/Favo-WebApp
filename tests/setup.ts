// Vitest global setup — runs before all tests
import "@testing-library/jest-dom/vitest";

// jsdom may not provide a fully functional localStorage when run via Bun.
// Replace it with a minimal in-memory implementation that exposes the full
// Storage interface (getItem, setItem, removeItem, clear, key, length).
const _storage = new Map<string, string>();
const localStorageMock: Storage = {
  getItem: (k) => _storage.get(k) ?? null,
  setItem: (k, v) => { _storage.set(k, String(v)); },
  removeItem: (k) => { _storage.delete(k); },
  clear: () => { _storage.clear(); },
  key: (i) => [..._storage.keys()][i] ?? null,
  get length() { return _storage.size; },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

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
