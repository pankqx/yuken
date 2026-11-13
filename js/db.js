// Storage layer. Everything goes through this module so the backend can be
// swapped later without touching the UI.

const DB_NAME = 'yuken-pol';
const DB_VERSION = 1;
export const STORES = ['users', 'dispatches', 'settings', 'audit'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async all(store) {
    const db = await open();
    return req2p(db.transaction(store).objectStore(store).getAll());
  },
  async get(store, id) {
    const db = await open();
    return req2p(db.transaction(store).objectStore(store).get(id));
  },
  put(store, obj) {
    return tx(store, 'readwrite', s => { s.put(obj); return obj; });
  },
  del(store, id) {
    return tx(store, 'readwrite', s => { s.delete(id); });
  },
  clear(store) {
    return tx(store, 'readwrite', s => { s.clear(); });
  },
  async exportAll() {
    const out = { app: 'yuken-pol', version: 1, exportedAt: new Date().toISOString() };
    for (const s of STORES) out[s] = await this.all(s);
    return out;
  },
  async importAll(data) {
    if (!data || data.app !== 'yuken-pol') throw new Error('This file is not a Yuken backup.');
    for (const s of STORES) {
      await this.clear(s);
      for (const row of data[s] || []) await this.put(s, row);
    }
  }
};

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
