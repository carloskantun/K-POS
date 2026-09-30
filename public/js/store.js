// Estado en memoria + escrituras locales. Toda escritura va primero a IndexedDB y a la cola
// de salida (outbox); la sincronización la sube cuando hay conexión.
import * as db from './db.js';
import { TABLE_NAMES, ROLES } from './shared/schema.js';
import { round3 } from './shared/util.js';

export const S = {
  data: Object.fromEntries(TABLE_NAMES.map((t) => [t, new Map()])),
  stock: new Map(),
  meta: {},
  user: null,
  online: navigator.onLine,
  pending: 0,
  syncing: false,
  syncError: null,
  lastSync: 0,
};

const listeners = new Set();
let changed = new Set();
let timer = null;

export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(tables) {
  for (const t of tables) changed.add(t);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const c = changed;
    changed = new Set();
    for (const fn of [...listeners]) {
      try { fn(c); } catch (e) { console.error(e); }
    }
  }, 16);
}

// Un dispositivo puede tener varios negocios (ej. dueño con dos sucursales o dos marcas):
// cada uno vive en su propia base local.
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
export const activeDb = () => ls.get('kpos.active', 'kpos');
export const accounts = () => ls.get('kpos.accounts', []);
export function rememberAccount(name) {
  const db = activeDb();
  ls.set('kpos.accounts', [...accounts().filter((a) => a.db !== db), { db, name }]);
}
export function switchAccount(db) {
  ls.set('kpos.active', db);
  location.hash = '';
  location.reload();
}
export function newAccount() {
  switchAccount(`kpos-${Date.now().toString(36)}`);
}
export function forgetAccount(db) {
  const rest = accounts().filter((a) => a.db !== db);
  ls.set('kpos.accounts', rest);
  ls.set('kpos.active', rest[0]?.db || 'kpos');
}

const channel = 'BroadcastChannel' in self ? new BroadcastChannel(`kpos:${activeDb()}`) : null;
let pushHook = () => {};
export const setPushHook = (fn) => { pushHook = fn; };

export async function init() {
  await db.open(activeDb());
  S.meta = await db.getMeta();
  if (S.meta.tenant) rememberAccount(S.meta.tenant.name);
  // Pide al navegador no borrar los datos locales aunque falte espacio o no se use la app en días.
  try { S.persisted = await navigator.storage?.persist?.(); } catch { S.persisted = false; }
  await loadAll();
  if (S.meta.user_id) S.user = S.data.users.get(S.meta.user_id) || null;
  await prune();
  if (channel) {
    channel.onmessage = async (e) => {
      if (e.data?.type === 'rows') {
        for (const [t, id] of e.data.rows) {
          const row = await db.get(t, id);
          if (row) S.data[t].set(id, row);
        }
        await loadStock();
        S.meta = await db.getMeta();
        await refreshPending();
        emit(new Set(e.data.rows.map((r) => r[0])));
      } else if (e.data?.type === 'reload') {
        location.reload();
      }
    };
  }
}

async function loadAll() {
  for (const t of TABLE_NAMES) {
    const rows = await db.all(t);
    S.data[t] = new Map(rows.map((r) => [r.id, r]));
  }
  await loadStock();
  await refreshPending();
}

async function loadStock() {
  const rows = await db.all('stock');
  S.stock = new Map(rows.map((r) => [r.key, r.qty]));
}

export async function refreshPending() {
  S.pending = (await db.all('outbox')).length;
}

// Borra del dispositivo historial viejo que ya se subió (la nube conserva todo).
async function prune() {
  const limit = Date.now() - 7 * 24 * 3600 * 1000;
  const box = new Set((await db.all('outbox')).map((e) => e.key));
  const del = [];
  const drop = (t, r) => {
    if (box.has(`${t}:${r.id}`)) return;
    S.data[t].delete(r.id);
    del.push([t, r.id, 'delete']);
  };
  const oldOrders = new Set();
  for (const o of S.data.orders.values()) {
    if (o.status !== 'open' && (o.closed_at || o.updated_at) < limit) { oldOrders.add(o.id); drop('orders', o); }
  }
  for (const t of ['order_items', 'payments']) {
    for (const r of S.data[t].values()) if (oldOrders.has(r.order_id) || (r.updated_at < limit && !S.data.orders.has(r.order_id))) drop(t, r);
  }
  for (const r of S.data.stock_moves.values()) if (r.created_at < limit) drop('stock_moves', r);
  for (const s of S.data.cash_sessions.values()) {
    if (s.status === 'closed' && s.closed_at < limit) {
      drop('cash_sessions', s);
      for (const m of S.data.cash_moves.values()) if (m.cash_session_id === s.id) drop('cash_moves', m);
    }
  }
  if (del.length) await db.write(del);
}

export async function setMeta(k, v) {
  S.meta[k] = v;
  await db.setMeta(k, v);
}

// ---------- Lectura ----------

export const get = (t, id) => (id ? S.data[t].get(id) : undefined);
export const list = (t, pred) => {
  const out = [];
  for (const r of S.data[t].values()) if (!r.deleted && (!pred || pred(r))) out.push(r);
  return out;
};
export const sorted = (t, pred) => list(t, pred).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)));

export const cfg = () => S.data.config.get('business')?.value || {};
export const mod = (name) => !!cfg().modules?.[name];
export const branchId = () => S.meta.branch_id;
export const tenantId = () => S.meta.tenant?.id;
export const currency = () => cfg().currency || 'MXN';

export function can(perm) {
  if (!S.user) return false;
  if (perm === 'charge' && S.user.role === 'mesero') return cfg().waiters_can_charge !== false;
  return (ROLES[S.user.role]?.perms || []).includes(perm);
}

const stockKey = (b, p) => `${b}|${p}`;
export const stockOf = (productId, b = branchId()) => S.stock.get(stockKey(b, productId)) || 0;

// Porciones disponibles: stock propio, o lo que alcanzan los insumos de la receta.
export function available(p, b = branchId()) {
  if (p.track_stock) return stockOf(p.id, b);
  const comps = (p.recipe || []).map((c) => ({ c, prod: get('products', c.product_id) })).filter((x) => x.prod?.track_stock && x.c.qty > 0);
  if (!comps.length || !mod('recipes')) return null;
  return Math.max(0, Math.min(...comps.map(({ c, prod }) => Math.floor(stockOf(prod.id, b) / c.qty))));
}

export function isLow(p, b = branchId()) {
  if (!p.track_stock) return false;
  return stockOf(p.id, b) <= (Number(p.stock_min) || 0);
}

export function openCashSession(b = branchId()) {
  return list('cash_sessions', (s) => s.status === 'open' && s.branch_id === b).sort((a, c) => c.opened_at - a.opened_at)[0] || null;
}

// ---------- Escritura ----------

// list: [[tabla, fila]]. Asigna updated_at, guarda en IndexedDB, encola para subir y avisa a la UI.
export async function save(rows) {
  const now = Date.now();
  const entries = [];
  const touched = new Set();
  const saved = [];
  for (const [t, row] of rows) {
    const prev = S.data[t].get(row.id);
    if (t === 'stock_moves' && prev) continue;
    row.updated_at = Math.max(now, (prev?.updated_at || 0) + 1);
    row.deleted = row.deleted ? 1 : 0;
    if (t === 'stock_moves') entries.push(applyStock(row));
    S.data[t].set(row.id, row);
    entries.push([t, row]);
    entries.push(['outbox', { key: `${t}:${row.id}`, t, id: row.id, v: row.updated_at }]);
    touched.add(t);
    saved.push([t, row.id]);
  }
  await db.write(entries);
  await refreshPending();
  emit(touched);
  channel?.postMessage({ type: 'rows', rows: saved });
  pushHook();
}

export function applyStock(move) {
  const key = stockKey(move.branch_id, move.product_id);
  const qty = round3((S.stock.get(key) || 0) + Number(move.qty || 0));
  S.stock.set(key, qty);
  return ['stock', { key, branch_id: move.branch_id, product_id: move.product_id, qty }];
}

// Filas que llegan del servidor: no vuelven a la cola de salida.
export async function applyRemote(changes, { stock } = {}) {
  const entries = [];
  const touched = new Set();
  const box = new Map((await db.all('outbox')).map((e) => [e.key, e]));
  if (stock) {
    await db.clear(['stock']);
    S.stock = new Map();
    for (const s of stock) {
      const key = stockKey(s.branch_id, s.product_id);
      S.stock.set(key, round3(s.qty));
      entries.push(['stock', { key, branch_id: s.branch_id, product_id: s.product_id, qty: round3(s.qty) }]);
    }
  }
  const rows = [];
  for (const [t, list2] of Object.entries(changes || {})) {
    if (!S.data[t]) continue;
    for (const r of list2) {
      const local = S.data[t].get(r.id);
      const pending = box.get(`${t}:${r.id}`);
      if (pending && local && local.updated_at > r.updated_at) continue;
      if (t === 'stock_moves' && !local && !stock) entries.push(applyStock(r));
      S.data[t].set(r.id, r);
      entries.push([t, r]);
      touched.add(t);
      rows.push([t, r.id]);
    }
  }
  await db.write(entries);
  if (touched.size || stock) {
    emit(touched.size ? touched : new Set(['stock_moves']));
    channel?.postMessage({ type: 'rows', rows });
  }
}

export async function enqueueEverything() {
  const entries = [];
  for (const t of TABLE_NAMES) {
    for (const r of S.data[t].values()) entries.push(['outbox', { key: `${t}:${r.id}`, t, id: r.id, v: r.updated_at }]);
  }
  await db.write(entries);
  await refreshPending();
}

export async function resetDevice() {
  await db.wipe();
  channel?.postMessage({ type: 'reload' });
  forgetAccount(activeDb());
}

export function login(user) {
  S.user = user;
  return setMeta('user_id', user?.id || null);
}
