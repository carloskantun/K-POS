import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEnv } from '../hub/server.js';
import worker from '../worker/src/index.js';
import { sha256hex, uid, dayRange, localDate } from '../public/js/shared/util.js';
import { buildSeed } from '../public/js/shared/presets.js';
import { computeSummary } from '../public/js/shared/report.js';

const ctx = { waitUntil: (p) => p.catch(() => {}) };

function client(env) {
  let token = null;
  const call = async (method, path, body) => {
    const res = await worker.fetch(new Request(`http://kpos.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, ctx);
    return { status: res.status, data: await res.json() };
  };
  return { call, setToken: (t) => { token = t; } };
}

const seedChanges = (rows) => Object.entries(rows).flatMap(([t, list]) => list.map((r) => ({ t, r })));

test('sha256 puro coincide con node:crypto', () => {
  for (const s of ['', 'abc', 'kpos:tenant:1234', 'ñandú 🌮'.repeat(20)]) {
    assert.equal(sha256hex(s), createHash('sha256').update(s).digest('hex'));
  }
});

test('rango de día respeta la zona horaria', () => {
  const { from, to } = dayRange('2026-03-10', 'America/Mexico_City');
  assert.equal(to - from, 24 * 3600 * 1000);
  assert.equal(localDate(from, 'America/Mexico_City'), '2026-03-10');
  assert.equal(localDate(from - 1, 'America/Mexico_City'), '2026-03-09');
});

test('registro, sincronización, reglas de fusión y resumen', async () => {
  const env = await createEnv(':memory:');
  const a = client(env);
  const tenantId = uid();

  let r = await a.call('POST', '/api/register', { tenant_id: tenantId, slug: 'taqueria-lupita', name: 'Taquería Lupita', business_type: 'taqueria', email: 'Lupita@Example.com', password: 'secreto1', device_name: 'Caja' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tenant.id, tenantId);
  a.setToken(r.data.token);

  r = await a.call('POST', '/api/register', { slug: 'taqueria-lupita', name: 'x', email: 'a@b.c', password: 'secreto1' });
  assert.equal(r.status, 409);

  const seed = buildSeed({ type: 'taqueria', tenantId, businessName: 'Taquería Lupita', ownerName: 'Lupita', pin: '1234' });
  r = await a.call('POST', '/api/sync/push', { changes: seedChanges(seed.rows) });
  assert.equal(r.status, 200);

  // Segundo dispositivo vinculado con código.
  r = await a.call('POST', '/api/link-code', { purpose: 'device' });
  const code = r.data.code;
  const b = client(env);
  r = await b.call('POST', '/api/link', { slug: 'taqueria-lupita', code, device_name: 'Cocina' });
  assert.equal(r.status, 200);
  b.setToken(r.data.token);

  r = await b.call('GET', '/api/sync/pull?since=0');
  const products = r.data.changes.products;
  assert.equal(products.length, seed.rows.products.length);
  const taco = products.find((p) => p.name === 'Taco al pastor');
  assert.ok(Array.isArray(taco.recipe) && taco.recipe.length === 2, 'recipe como JSON');
  const tortilla = products.find((p) => p.name === 'Tortilla');
  const stock0 = r.data.stock.find((s) => s.product_id === tortilla.id).qty;
  assert.equal(stock0, 500);
  const cursor1 = r.data.cursor;

  // Venta: cuenta pagada con 3 tacos (6 tortillas).
  const now = Date.now();
  const branchId = seed.branchId;
  const order = { id: uid(), updated_at: now, branch_id: branchId, number: 1, status: 'paid', kind: 'mostrador', subtotal: 54, discount: 0, total: 54, opened_at: now, closed_at: now, user_id: seed.rows.users[0].id };
  const item = { id: uid(), updated_at: now, order_id: order.id, branch_id: branchId, product_id: taco.id, name: taco.name, qty: 3, price: 18, total: 54, status: 'ready', sent_at: now };
  const pay = { id: uid(), updated_at: now, order_id: order.id, branch_id: branchId, method: 'efectivo', amount: 54, received: 100, change_given: 46, created_at: now };
  const move = { id: `sm-${item.id}-${tortilla.id}`, updated_at: now, branch_id: branchId, product_id: tortilla.id, qty: -6, kind: 'sale', ref_id: item.id, created_at: now };
  r = await a.call('POST', '/api/sync/push', { changes: [{ t: 'orders', r: order }, { t: 'order_items', r: item }, { t: 'payments', r: pay }, { t: 'stock_moves', r: move }] });
  assert.equal(r.status, 200);
  // Reenvío idempotente del mismo movimiento.
  await a.call('POST', '/api/sync/push', { changes: [{ t: 'stock_moves', r: move }] });

  r = await b.call('GET', `/api/sync/pull?since=${cursor1}`);
  assert.equal(r.data.changes.orders.length, 1);
  assert.equal(r.data.changes.stock_moves.length, 1);
  const cursor2 = r.data.cursor;

  // Un dispositivo atrasado intenta regresar el platillo de "ready" a "sent": se rechaza y recibe la versión vigente.
  r = await b.call('POST', '/api/sync/push', { changes: [{ t: 'order_items', r: { ...item, status: 'sent', updated_at: now + 1000 } }] });
  assert.equal(r.data.current.order_items[0].status, 'ready');
  // Una versión más vieja tampoco pisa a la nueva.
  r = await b.call('POST', '/api/sync/push', { changes: [{ t: 'orders', r: { ...order, note: 'viejo', updated_at: now - 5000 } }] });
  assert.equal(r.data.current.orders[0].note, null);

  r = await b.call('GET', `/api/sync/pull?since=${cursor2}`);
  assert.equal(Object.keys(r.data.changes).length, 0);

  // Resumen del día (mismo cálculo que el bot de Telegram).
  const date = localDate(now, 'America/Mexico_City');
  r = await a.call('GET', `/api/reports/summary?date=${date}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 54);
  assert.equal(r.data.tickets, 1);
  assert.equal(r.data.by_method.efectivo, 54);
  assert.equal(r.data.inventory.find((i) => i.product_id === tortilla.id).qty, 494);

  // Otro negocio no puede ver ni pisar filas ajenas.
  const c = client(env);
  r = await c.call('POST', '/api/register', { slug: 'abarrotes-don-pepe', name: 'Don Pepe', email: 'p@p.mx', password: 'secreto2' });
  c.setToken(r.data.token);
  r = await c.call('POST', '/api/sync/push', { changes: [{ t: 'orders', r: { ...order, total: 1, updated_at: now + 99999 } }] });
  r = await a.call('GET', `/api/reports/summary?date=${date}`);
  assert.equal(r.data.total, 54);
  r = await c.call('GET', '/api/sync/pull?since=0');
  assert.equal(r.data.changes.orders.length, 1);
  assert.equal(r.data.changes.products, undefined);

  // Sin token → 401
  r = await client(env).call('GET', '/api/sync/pull?since=0');
  assert.equal(r.status, 401);

  // Login del dueño desde otro dispositivo.
  r = await client(env).call('POST', '/api/login', { slug: 'taqueria-lupita', email: 'lupita@example.com', password: 'secreto1' });
  assert.equal(r.status, 200);
  r = await client(env).call('POST', '/api/login', { slug: 'taqueria-lupita', email: 'lupita@example.com', password: 'mala' });
  assert.equal(r.status, 401);
});

test('resumen: caja, cancelaciones y stock bajo', () => {
  const t0 = Date.UTC(2026, 0, 1, 18);
  const s = computeSummary({
    orders: [
      { id: 'o1', status: 'paid', total: 100, closed_at: t0, user_id: 'u1' },
      { id: 'o2', status: 'cancelled', total: 50, closed_at: t0 },
      { id: 'o3', status: 'paid', total: 999, closed_at: t0 - 86400000 * 2 },
    ],
    order_items: [
      { id: 'i1', order_id: 'o1', product_id: 'p1', name: 'Taco', qty: 5, total: 100, status: 'served' },
      { id: 'i2', order_id: 'o1', product_id: 'p1', name: 'Taco', qty: 1, total: 20, status: 'cancelled', sent_at: t0, updated_at: t0 },
    ],
    payments: [{ id: 'y1', order_id: 'o1', method: 'tarjeta', amount: 100, cash_session_id: 'c1' }],
    cash_sessions: [{ id: 'c1', status: 'open', opening_amount: 500 }],
    cash_moves: [{ id: 'm1', cash_session_id: 'c1', kind: 'out', amount: 100 }],
    products: [{ id: 'p1', name: 'Taco', track_stock: 1, stock_min: 10 }],
    users: [{ id: 'u1', name: 'Ana' }],
    stock: [{ product_id: 'p1', qty: 4 }],
  }, { from: t0 - 3600000, to: t0 + 3600000 });
  assert.equal(s.total, 100);
  assert.equal(s.tickets, 1);
  assert.equal(s.cancelled_orders, 1);
  assert.equal(s.cancelled_items, 1);
  assert.equal(s.by_method.tarjeta, 100);
  assert.equal(s.cash[0].expected, 400);
  assert.equal(s.low_stock.length, 1);
  assert.equal(s.by_user[0].name, 'Ana');
});
