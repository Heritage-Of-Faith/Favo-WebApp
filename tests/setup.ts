// Vitest global setup — runs before all tests
import "@testing-library/jest-dom/vitest";

// Node >= 22 ships an experimental `localStorage` global (backed by
// --localstorage-file) that shadows jsdom's implementation with a
// non-functional stub (no getItem/setItem/clear). Install a real in-memory
// Storage so components and tests using localStorage work deterministically.
if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(String(k)) ?? null,
    setItem: (k: string, v: string) => void store.set(String(k), String(v)),
    removeItem: (k: string) => void store.delete(String(k)),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

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
