// Optional browser storage must never abort a successful server operation.
// The memory fallback lasts only for this page; persistence remains best effort.
const createStore = (name) => {
  const memory = new Map();
  return Object.freeze({
    getItem(key) {
      try { return window[name].getItem(key) ?? memory.get(key) ?? null; }
      catch { return memory.get(key) ?? null; }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try { window[name].setItem(key, String(value)); return true; }
      catch { return false; }
    },
    removeItem(key) {
      memory.delete(key);
      try { window[name].removeItem(key); } catch { /* storage denied */ }
    }
  });
};

export const localStore = createStore('localStorage');
export const sessionStore = createStore('sessionStorage');
