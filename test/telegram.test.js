import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from '../hub/server.js';
import worker from '../worker/src/index.js';
import { scheduled } from '../worker/src/telegram.js';
import { uid, localDate, localHour } from '../public/js/shared/util.js';
import { buildSeed } from '../public/js/shared/presets.js';

test('Telegram: vincular chat, corte de caja, stock bajo y resumen diario', async (t) => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      sent.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true }));
    }
    return realFetch(url, init);
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const env = await createEnv(':memory:', { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_WEBHOOK_SECRET: 's3cr3t' });
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  let token;
  const call = async (method, path, body, headers = {}) => {
    const res = await worker.fetch(new Request(`http://k.test${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env, ctx);
    await Promise.all(waits.splice(0));
    return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
  };

  const tenantId = uid();
  const reg = await call('POST', '/api/register', { tenant_id: tenantId, slug: 'bar-el-gallo', name: 'Bar El Gallo', email: 'g@g.mx', password: 'secreto1' });
  token = reg.token;
  const seed = buildSeed({ type: 'bar', tenantId, businessName: 'Bar El Gallo', ownerName: 'Gallo', pin: '1234', timezone: 'UTC' });
  await call('POST', '/api/sync/push', { changes: Object.entries(seed.rows).flatMap(([tb, rows]) => rows.map((r) => ({ t: tb, r }))) });

  // Webhook sin secreto → 403
  const forbidden = await worker.fetch(new Request('http://k.test/api/telegram/webhook', { method: 'POST', body: '{}' }), env, ctx);
  assert.equal(forbidden.status, 403);

  const { code } = await call('POST', '/api/link-code', { purpose: 'telegram' });
  const hook = (text) => call('POST', '/api/telegram/webhook', { message: { text, chat: { id: -100123, title: 'Socios' } } }, { 'x-telegram-bot-api-secret-token': 's3cr3t' });
  await hook(`/vincular ${code}`);
  assert.match(sent.at(-1).body.text, /vinculado con <b>Bar El Gallo<\/b>/);

  // Se venden 100 cervezas de 120 (mínimo 24): llega alerta de stock bajo una sola vez al día.
  const cerveza = seed.rows.products.find((p) => p.name === 'Corona');
  const now = Date.now();
  const move = (q) => ({ t: 'stock_moves', r: { id: uid(), updated_at: now, branch_id: seed.branchId, product_id: cerveza.id, qty: q, kind: 'sale', created_at: now } });
  sent.length = 0;
  await call('POST', '/api/sync/push', { changes: [move(-100)] });
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /Stock bajo[\s\S]*Corona: quedan 20/);
  await call('POST', '/api/sync/push', { changes: [move(-1)] });
  assert.equal(sent.length, 1, 'no repite la alerta el mismo día');

  // Corte de caja con faltante.
  sent.length = 0;
  const session = { id: uid(), updated_at: now, branch_id: seed.branchId, opened_at: now - 3600000, opening_amount: 500, status: 'closed', closed_at: now, counted_cash: 1450, expected_cash: 1500, summary: { sales: 1000, closed_by: 'Gallo', methods: { efectivo: 1000, tarjeta: 300 }, tickets: 12, total: 1300 } };
  await call('POST', '/api/sync/push', { changes: [{ t: 'cash_sessions', r: session }] });
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /Corte de caja[\s\S]*Faltante \$50\.00/);

  // Comandos
  sent.length = 0;
  await hook('/stock');
  assert.match(sent[0].body.text, /Corona/);
  await hook('/hoy');
  assert.match(sent[1].body.text, /Cómo va hoy/);

  // Cron: a la hora configurada manda el resumen de ayer una sola vez.
  sent.length = 0;
  const cfgRow = seed.rows.config[0];
  const hour = localHour(Date.now(), 'UTC');
  await call('POST', '/api/sync/push', { changes: [{ t: 'config', r: { ...cfgRow, updated_at: now + 1, value: { ...cfgRow.value, report_hour: hour } } }] });
  await scheduled(env);
  await scheduled(env);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /Resumen de ayer/);
  assert.ok(sent[0].body.text.includes(localDate(Date.now() - 86400000, 'UTC')));
});

test('venta: espera todos los pagos, entrega por chat, reintenta fallo y respeta preferencias', async t => {
  const {afterPush,drainOutbox}=await import('../worker/src/telegram.js');
  const {push}=await import('../worker/src/sync.js');
  const env=await createEnv(':memory:',{TELEGRAM_BOT_TOKEN:'mock',TELEGRAM_WEBHOOK_SECRET:'secret'});
  const realFetch=globalThis.fetch, sent=[];let failSecond=true;
  globalThis.fetch=async (_url,init)=> { const b=JSON.parse(init.body); const ok=!(b.chat_id==='2'&&failSecond);sent.push({...b,ok});return new Response(JSON.stringify({ok})); };
  t.after(()=>{globalThis.fetch=realFetch;});
  await env.DB.prepare("INSERT INTO tenants (id,slug,name,owner_email,owner_pass,created_at) VALUES ('t','telegram-test','Rock','x@y.mx','mock',1)").run();
  await env.DB.prepare("INSERT INTO telegram_chats (tenant_id,chat_id,title,created_at) VALUES ('t','1','Dueño',1),('t','2','Socios',1)").run();
  const seed=buildSeed({type:'rockalitas',tenantId:'t',businessName:'Rock',ownerName:'Carlos',pin:'1234',timezone:'UTC'});
  await push(env,'t',Object.entries(seed.rows).flatMap(([t,rows])=>rows.map(r=>({t,r}))));
  const now=Date.now();
  const order={t:'orders',r:{id:'sale',updated_at:now,number:12,branch_id:seed.branchId,user_id:seed.rows.users[0].id,status:'paid',total:320,closed_at:now,opened_at:now}};
  let r=await push(env,'t',[order]);await afterPush(env,'t',r.applied);assert.equal(sent.length,0,'no avisa antes de recibir el pago');
  const payment={t:'payments',r:{id:'p1',updated_at:now,order_id:'sale',amount:120,tip:12,method:'efectivo',branch_id:seed.branchId,created_at:now}};
  r=await push(env,'t',[payment]);await afterPush(env,'t',r.applied);assert.equal(sent.length,0);
  const second={t:'payments',r:{...payment.r,id:'p2',amount:200,tip:20,method:'tarjeta'}};
  r=await push(env,'t',[second]);await afterPush(env,'t',r.applied);
  assert.equal(sent.length,2);assert.match(sent[0].text,/Venta cobrada[\s\S]*Total: \$320.00[\s\S]*Carlos[\s\S]*Propina: \$32.00/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM telegram_outbox WHERE sent_at IS NULL').first()).n,1);
  failSecond=false;await env.DB.prepare('UPDATE telegram_outbox SET next_attempt=0').run();await drainOutbox(env,'t');
  assert.equal(sent.length,3);assert.equal(sent[2].chat_id,'2','solo reintenta el chat fallido');
  r=await push(env,'t',[{...order,r:{...order.r,updated_at:now+1}},second]);await afterPush(env,'t',r.applied);assert.equal(sent.length,3,'reenvío de sincronización no duplica aviso');
  await env.DB.prepare("UPDATE config SET value=json_set(value,'$.telegram_sales',json('false')) WHERE tenant_id='t'").run();
  const disabled=[{...order,r:{...order.r,id:'sale2'}},{...payment,r:{...payment.r,id:'p3',order_id:'sale2',amount:320}}];
  r=await push(env,'t',disabled);await afterPush(env,'t',r.applied);assert.equal(sent.length,3);
  const unsafe=await worker.fetch(new Request('http://test/api/telegram/webhook',{method:'POST',body:'{}'}),{...env,TELEGRAM_WEBHOOK_SECRET:''},{waitUntil(){}});assert.equal(unsafe.status,403);
});
