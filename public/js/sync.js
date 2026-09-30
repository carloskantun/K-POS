// Motor de sincronización: sube la cola local y baja cambios de otros dispositivos.
import * as db from './db.js';
import { S, emit, applyRemote, refreshPending, setMeta, setPushHook } from './store.js';

const PULL_EVERY = 4000;
let running = false;
let again = false;
let pushTimer = null;
let loopTimer = null;

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && S.meta.device?.token) headers.authorization = `Bearer ${S.meta.device.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const canSync = () => !!S.meta.device?.token && !S.meta.demo;

async function pushOnce() {
  const box = await db.all('outbox');
  if (!box.length) return;
  for (let i = 0; i < box.length; i += 150) {
    const chunk = box.slice(i, i + 150);
    const changes = [];
    for (const e of chunk) {
      const r = S.data[e.t]?.get(e.id);
      if (r) changes.push({ t: e.t, r });
    }
    const res = await api('/api/sync/push', { method: 'POST', body: { changes } });
    // Solo se quita de la cola si la fila no cambió mientras se subía.
    const del = chunk.filter((e) => (S.data[e.t]?.get(e.id)?.updated_at ?? e.v) === e.v || !S.data[e.t]?.has(e.id)).map((e) => ['outbox', e.key, 'delete']);
    await db.write(del);
    if (res.current && Object.keys(res.current).length) await applyRemote(res.current);
  }
  await refreshPending();
}

async function pullOnce() {
  let since = S.meta.cursor || 0;
  for (let guard = 0; guard < 50; guard++) {
    const res = await api(`/api/sync/pull?since=${since}`);
    await applyRemote(res.changes, { stock: res.stock });
    since = res.cursor;
    await setMeta('cursor', since);
    if (!res.more) break;
  }
}

export async function syncNow() {
  if (!canSync()) return;
  if (running) { again = true; return; }
  running = true;
  S.syncing = true;
  emit(['_sync']);
  try {
    do {
      again = false;
      await pushOnce();
      await pullOnce();
    } while (again);
    S.online = true;
    S.syncError = null;
    S.lastSync = Date.now();
  } catch (e) {
    if (e.status === 401) S.syncError = 'Dispositivo desvinculado';
    else { S.online = false; S.syncError = null; }
  } finally {
    running = false;
    S.syncing = false;
    emit(['_sync']);
  }
}

export function startSync() {
  setPushHook(() => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 250);
  });
  const tick = () => {
    clearTimeout(loopTimer);
    if (document.visibilityState === 'visible') syncNow();
    loopTimer = setTimeout(tick, PULL_EVERY);
  };
  window.addEventListener('online', () => { S.online = true; syncNow(); });
  window.addEventListener('offline', () => { S.online = false; emit(['_sync']); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  tick();
}
