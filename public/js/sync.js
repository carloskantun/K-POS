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
  // Deja margen en D1 gratuito para autenticación y filas rechazadas (hasta 50 consultas por petición).
  for (let i = 0; i < box.length; i += 20) {
    const chunk = box.slice(i, i + 20);
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
    if (res.live && !S.live && !ws) connectLive();
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
    else if (e.status === 402) S.syncError = 'Cuenta suspendida';
    else { S.online = false; S.syncError = null; }
  } finally {
    running = false;
    S.syncing = false;
    emit(['_sync']);
  }
}

// Canal en tiempo real: el servidor avisa cuando otro dispositivo subió cambios.
let ws = null;
let wsRetry = 1000;
let wsPing = null;
function connectLive() {
  if (!canSync() || !('WebSocket' in self)) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live?token=${encodeURIComponent(S.meta.device.token)}`;
  try { ws = new WebSocket(url); } catch { return; }
  ws.onopen = () => {
    S.live = true;
    wsRetry = 1000;
    clearInterval(wsPing);
    wsPing = setInterval(() => { try { ws.send('ping'); } catch { /* cerrado */ } }, 25000);
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    try {
      const m = JSON.parse(e.data);
      if (m.by !== S.meta.device?.id) syncNow();
    } catch { /* mensaje desconocido */ }
  };
  ws.onclose = (e) => {
    S.live = false;
    ws = null;
    clearInterval(wsPing);
    if (e.code === 1008 || e.code === 4001) return;
    // El servidor local (hub) no tiene tiempo real: se queda con la consulta periódica.
    wsRetry = Math.min(wsRetry * 2, 30000);
    setTimeout(() => { if (!ws) connectLive(); }, wsRetry);
  };
}

export function startSync() {
  setPushHook(() => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 250);
  });
  const tick = () => {
    clearTimeout(loopTimer);
    if (document.visibilityState === 'visible') syncNow();
    loopTimer = setTimeout(tick, S.live ? 20000 : PULL_EVERY);
  };
  window.addEventListener('online', () => { S.online = true; syncNow(); });
  window.addEventListener('offline', () => { S.online = false; emit(['_sync']); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  tick();
}
