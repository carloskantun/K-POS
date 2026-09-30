import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from '../hub/server.js';
import worker from '../worker/src/index.js';
import { uid, localDate } from '../public/js/shared/util.js';
import { buildSeed } from '../public/js/shared/presets.js';
import { parseCSV, productFromRow, toCSV } from '../public/js/shared/csv.js';

const ctx = { waitUntil: (p) => p.catch(() => {}) };

function client(env, ip = '1.1.1.1') {
  let token = null;
  const call = async (method, path, body, headers = {}) => {
    const res = await worker.fetch(new Request(`http://k.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env, ctx);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, data };
  };
  return { call, setToken: (t) => { token = t; } };
}

async function setupBar(env) {
  const a = client(env);
  const tenantId = uid();
  const r = await a.call('POST', '/api/register', { tenant_id: tenantId, slug: 'rockalitas', name: 'Rockalitas', business_type: 'bar', email: 'dueno@rockalitas.mx', password: 'rock1234' });
  a.setToken(r.data.token);
  const seed = buildSeed({ type: 'bar', tenantId, businessName: 'Rockalitas', ownerName: 'Dueño', pin: '1234', timezone: 'UTC' });
  await a.call('POST', '/api/sync/push', { changes: Object.entries(seed.rows).flatMap(([t, rows]) => rows.map((row) => ({ t, r: row }))) });
  return { a, tenantId, seed };
}

test('preset bar: extras/variantes en alitas, michelada y cubetas', () => {
  const seed = buildSeed({ type: 'bar', tenantId: 't', businessName: 'Rockalitas', ownerName: 'X', pin: '1234' });
  const alitas = seed.rows.products.find((p) => /Alitas/.test(p.name));
  assert.ok(alitas.modifiers.some((g) => g.required && g.options.length >= 3), 'alitas pide salsa');
  const cubeta = seed.rows.products.find((p) => /Cubeta/.test(p.name));
  assert.ok(cubeta.modifiers[0].options.every((o) => o.product_id && o.qty === 6), 'cubeta descuenta 6 cervezas de la marca elegida');
  assert.ok(seed.rows.tables.length >= 10);
});

test('propinas, bitácora de cancelaciones y exportación CSV', async () => {
  const env = await createEnv(':memory:');
  const { a, seed } = await setupBar(env);
  const now = Date.now();
  const alitas = seed.rows.products.find((p) => /Alitas/.test(p.name));
  const owner = seed.rows.users[0];
  const order = { id: uid(), updated_at: now, branch_id: seed.branchId, number: 7, status: 'paid', kind: 'mesa', subtotal: 330, discount: 0, total: 330, opened_at: now - 1000, closed_at: now, user_id: owner.id, table_id: seed.rows.tables[0].id };
  const item = { id: uid(), updated_at: now, order_id: order.id, branch_id: seed.branchId, product_id: alitas.id, name: alitas.name, qty: 2, price: 165, total: 330, status: 'served', mods: [{ g: 'Salsa', name: 'Mango habanero', price: 0 }] };
  const pays = [
    { id: uid(), updated_at: now, order_id: order.id, branch_id: seed.branchId, method: 'efectivo', amount: 165, received: 200, change_given: 10, tip: 25, created_at: now },
    { id: uid(), updated_at: now, order_id: order.id, branch_id: seed.branchId, method: 'tarjeta', amount: 165, received: 190, change_given: 0, tip: 25, created_at: now },
  ];
  const audit = { id: uid(), updated_at: now, branch_id: seed.branchId, user_id: owner.id, authorized_by: owner.id, action: 'cancel_item', ref_id: 'x', detail: '1 Cerveza · Mesa 1: se equivocó', amount: 45, created_at: now };
  await a.call('POST', '/api/sync/push', { changes: [{ t: 'orders', r: order }, { t: 'order_items', r: item }, ...pays.map((p) => ({ t: 'payments', r: p })), { t: 'audit', r: audit }] });

  const date = localDate(now, 'UTC');
  let r = await a.call('GET', `/api/reports/summary?date=${date}`);
  assert.equal(r.data.total, 330);
  assert.equal(r.data.tips, 50);
  assert.equal(r.data.by_user[0].tips, 50);
  assert.equal(r.data.audit.length, 1);
  assert.equal(r.data.audit[0].authorized, 'Dueño');

  r = await a.call('GET', `/api/export/sales?from=${date}&to=${date}`);
  assert.equal(r.status, 200);
  const rows = parseCSV(r.data);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].extras, 'Mango habanero');
  assert.equal(rows[0].metodo_pago, 'Efectivo + Tarjeta');
  assert.equal(rows[0].propina, '50');
  r = await a.call('GET', '/api/export/sales?from=2026-01-01&to=2026-12-31');
  assert.equal(r.status, 400);
});

test('contraseña: cambio, recuperación y límite de intentos', async () => {
  const sent = [];
  const env = await createEnv(':memory:', { RESEND_API_KEY: 'k' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('resend.com')) { sent.push(JSON.parse(init.body)); return new Response('{}'); }
    return realFetch(url, init);
  };
  try {
    const { a } = await setupBar(env);
    let r = await a.call('POST', '/api/password/change', { current: 'mala', password: 'nueva123' });
    assert.equal(r.status, 401);
    r = await a.call('POST', '/api/password/change', { current: 'rock1234', password: 'nueva123' });
    assert.equal(r.status, 200);

    const anon = client(env, '2.2.2.2');
    r = await anon.call('POST', '/api/password/forgot', { slug: 'rockalitas', email: 'nadie@x.mx' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 0, 'no revela si el correo existe ni manda nada');
    r = await anon.call('POST', '/api/password/forgot', { slug: 'rockalitas', email: 'dueno@rockalitas.mx' });
    await new Promise((res) => setTimeout(res, 10));
    assert.equal(sent.length, 1);
    const code = sent[0].html.match(/<h2>(\d{6})<\/h2>/)[1];
    r = await anon.call('POST', '/api/password/reset', { slug: 'rockalitas', code, password: 'otra1234' });
    assert.equal(r.status, 200);
    r = await anon.call('POST', '/api/login', { slug: 'rockalitas', email: 'dueno@rockalitas.mx', password: 'otra1234' });
    assert.equal(r.status, 200);

    const attacker = client(env, '9.9.9.9');
    let last;
    for (let i = 0; i < 12; i++) last = await attacker.call('POST', '/api/login', { slug: 'rockalitas', email: 'dueno@rockalitas.mx', password: `x${i}` });
    assert.equal(last.status, 429);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('admin: lista clientes, suspende y reactiva', async () => {
  const env = await createEnv(':memory:', { ADMIN_KEY: 'super-secreta' });
  const { a, tenantId } = await setupBar(env);
  const admin = client(env);
  let r = await admin.call('GET', '/api/admin/tenants', null, { 'x-admin-key': 'mala' });
  assert.equal(r.status, 403);
  r = await admin.call('GET', '/api/admin/tenants', null, { 'x-admin-key': 'super-secreta' });
  assert.equal(r.data.tenants[0].slug, 'rockalitas');
  assert.equal(r.data.tenants[0].devices, 1);

  await admin.call('POST', '/api/admin/tenants/update', { id: tenantId, status: 'suspended', plan: 'Bar $499', paid_until: Date.now() }, { 'x-admin-key': 'super-secreta' });
  r = await a.call('GET', '/api/sync/pull?since=0');
  assert.equal(r.status, 402);
  await admin.call('POST', '/api/admin/tenants/update', { id: tenantId, status: 'active' }, { 'x-admin-key': 'super-secreta' });
  r = await a.call('GET', '/api/sync/pull?since=0');
  assert.equal(r.status, 200);
  assert.equal(r.data.live, false, 'el servidor local no tiene tiempo real');

  r = await admin.call('POST', '/api/admin/tenants/link-code', { id: tenantId }, { 'x-admin-key': 'super-secreta' });
  const dev = await client(env, '3.3.3.3').call('POST', '/api/link', { slug: 'rockalitas', code: r.data.code, device_name: 'Barra' });
  assert.equal(dev.status, 200);
});

test('CSV: lee formato de Excel (punto y coma, acentos, comillas)', () => {
  const rows = parseCSV('﻿Nombre;Categoría;Precio;Existencia;Inventario\n"Cerveza ""Corona""";Cervezas;45,50;120;sí\nPapas;Botanas;$80;;no\n');
  const p = rows.map(productFromRow);
  assert.equal(p[0].name, 'Cerveza "Corona"');
  assert.equal(p[0].price, 45.5);
  assert.equal(p[0].stock, 120);
  assert.equal(p[0].track_stock, 1);
  assert.equal(p[1].track_stock, 0);
  assert.equal(p[1].price, 80);
  const back = parseCSV(toCSV([{ a: 'x,y', b: 'línea' }], ['a', 'b']));
  assert.deepEqual(back[0], { a: 'x,y', b: 'línea' });
});
