// IndexedDB: copia local completa del negocio para trabajar sin internet.
import { TABLE_NAMES } from './shared/schema.js';

const VERSION = 1;
let idb = null;

export function open(name = 'kpos') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const t of TABLE_NAMES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('stock')) d.createObjectStore('stock', { keyPath: 'key' });
    };
    req.onsuccess = () => { idb = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = idb.transaction(stores, mode);
    let out;
    try { out = fn(t); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function all(store) {
  const t = idb.transaction(store, 'readonly');
  return reqP(t.objectStore(store).getAll());
}

export async function get(store, key) {
  const t = idb.transaction(store, 'readonly');
  return reqP(t.objectStore(store).get(key));
}

// entries: [[store, value]] o [[store, key, 'delete']]
export function write(entries) {
  if (!entries.length) return Promise.resolve();
  const stores = [...new Set(entries.map((e) => e[0]))];
  return tx(stores, 'readwrite', (t) => {
    for (const e of entries) {
      if (e[2] === 'delete') t.objectStore(e[0]).delete(e[1]);
      else t.objectStore(e[0]).put(e[1]);
    }
  });
}

export function clear(stores) {
  return tx(stores, 'readwrite', (t) => stores.forEach((s) => t.objectStore(s).clear()));
}

export async function getMeta() {
  const rows = await all('meta');
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

export const setMeta = (k, v) => write([['meta', { k, v }]]);

export function wipe() {
  return clear([...TABLE_NAMES, 'meta', 'outbox', 'stock']);
}
