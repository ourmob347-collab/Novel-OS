import "@testing-library/jest-dom";

// Node 25 exposes a localStorage stub that is not a Storage object and hides
// jsdom's implementation, so getItem throws in tests.
if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });
  Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
}

// jsdom lacks matchMedia; ChapterView uses it for compact binder/notes.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
