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

test('enlaces automáticos: negocio correcto, grupo/privado, vencimiento y un solo uso', async t => {
  const env=await createEnv(':memory:',{TELEGRAM_BOT_TOKEN:'mock',TELEGRAM_WEBHOOK_SECRET:'hook',TELEGRAM_BOT_USERNAME:'kpos_avisos_bot',RATE_LIMIT:'off'});
  const original=globalThis.fetch, sent=[];
  globalThis.fetch=async (_url,init)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true}));};t.after(()=>{globalThis.fetch=original;});
  const waits=[],ctx={waitUntil:p=>waits.push(p)};
  async function call(path,{token,body,hook=false}={}) {
    const res=await worker.fetch(new Request(`http://test${path}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`} :{}),...(hook?{'x-telegram-bot-api-secret-token':'hook'}:{})},body:JSON.stringify(body||{})}),env,ctx);
    await Promise.all(waits.splice(0));return {status:res.status,data:res.headers.get('content-type')?.includes('json')?await res.json():await res.text()};
  }
  const register=async (slug,name)=> (await call('/api/register',{body:{tenant_id:uid(),slug,name,email:`${slug}@test.mx`,password:'secret123'}})).data;
  const rock=await register('rock-test','Rock Alitas'), tacos=await register('tacos-test','Taquería Lupita');
  const link=async (a,target)=> (await call('/api/link-code',{token:a.token,body:{purpose:'telegram',telegram_target:target}})).data;
  const start=async (code,id,type)=>call('/api/telegram/webhook',{hook:true,body:{message:{text:`/start@kpos_avisos_bot ${code}`,chat:{id,type,title:`Grupo ${id}`}}}});
  const group=await link(rock,'group');assert.equal(group.business,'Rock Alitas');assert.equal(group.code.length,64);assert.equal(group.url,`https://t.me/kpos_avisos_bot?startgroup=${group.code}`);
  await start(group.code,10,'private');assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM telegram_chats').first()).n,0,'un enlace de grupo no vincula un privado');
  await start(group.code,-10010,'supergroup');assert.match(sent.at(-1).text,/Chat vinculado con <b>Rock Alitas/);
  assert.equal((await env.DB.prepare('SELECT tenant_id FROM telegram_chats WHERE chat_id=?').bind('-10010').first()).tenant_id,rock.tenant.id);
  await start(group.code,-10011,'group');assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM telegram_chats').first()).n,1,'un código no vincula un segundo chat');
  const privateLink=await link(tacos,'private');assert.equal(privateLink.url,`https://t.me/kpos_avisos_bot?start=${privateLink.code}`);
  await start(privateLink.code,-10012,'group');await start(privateLink.code,12,'private');assert.match(sent.at(-1).text,/Taquería Lupita/);
  assert.equal((await env.DB.prepare('SELECT tenant_id FROM telegram_chats WHERE chat_id=?').bind('12').first()).tenant_id,tacos.tenant.id);
  const expired=await link(rock,'group');await env.DB.prepare('UPDATE link_codes SET expires_at=0 WHERE code=?').bind(expired.code).run();await start(expired.code,-10013,'group');assert.match(sent.at(-1).text,/vencido/);
  const one=await link(rock,'group');await Promise.all([start(one.code,-10014,'group'),start(one.code,-10015,'group')]);assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM telegram_chats WHERE chat_id IN ('-10014','-10015')").first()).n,1,'la vinculación resiste dos solicitudes simultáneas');
});
