// Bot de Telegram: resúmenes diarios, avisos de corte de caja y de stock bajo.
import { buildReport, getConfig, loadSummary } from './reports.js';
import { localDate, localHour, fmtMoney, fmtQty } from '../../public/js/shared/util.js';
import { PAY_METHODS } from '../../public/js/shared/schema.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function tgCall(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: 'TELEGRAM_BOT_TOKEN no configurado' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
    });
    return await res.json().catch(() => ({ ok: false }));
  } catch { return { ok: false, description: 'No se pudo contactar Telegram' }; }

}

// Telegram limita los mensajes a 4096 caracteres.
function chunks(text, size = 3900) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + line).length + 1 > size) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur) out.push(cur);
  return out;
}

export async function sendText(env, chatId, text) {
  for (const part of chunks(text)) {
    const r = await tgCall(env, 'sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true });
    if (!r.ok) throw new Error('Telegram no confirmó la entrega');
  }
}

export async function chatsOf(env, tenantId) {
  const r = await env.DB.prepare('SELECT chat_id, title FROM telegram_chats WHERE tenant_id = ?').bind(tenantId).all();
  return r.results || [];
}

export async function sendToTenant(env, tenantId, text) {
  const chats = await chatsOf(env, tenantId);
  for (const c of chats) await sendText(env, c.chat_id, text);
  return chats.length;
}

// ---------- Avisos al sincronizar ----------

// La venta ya está guardada aunque Telegram falle. Cada chat conserva su entrega pendiente.
export async function enqueueMessages(env, tenantId, chats, messages) {
  const rows = messages.flatMap(m => chats.map(c => [tenantId,m.key,String(c.chat_id),m.text,Date.now()]));
  for (let i=0;i<rows.length;i+=15) {
    const batch=rows.slice(i,i+15);
    await env.DB.prepare(`INSERT OR IGNORE INTO telegram_outbox (tenant_id,event_key,chat_id,text,created_at) VALUES ${batch.map(()=>'(?,?,?,?,?)').join(',')}`).bind(...batch.flat()).run();
  }
}
export async function drainOutbox(env, tenantId = null) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const now=Date.now();
  const rows=(await env.DB.prepare(`SELECT * FROM telegram_outbox WHERE sent_at IS NULL AND next_attempt<=? AND lease_until<=? ${tenantId?'AND tenant_id=?':''} ORDER BY created_at LIMIT 3`).bind(now,now,...(tenantId?[tenantId]:[])).all()).results || [];
  for (const r of rows) {
    const args=[r.tenant_id,r.event_key,r.chat_id];
    const claim=await env.DB.prepare('UPDATE telegram_outbox SET lease_until=? WHERE tenant_id=? AND event_key=? AND chat_id=? AND sent_at IS NULL AND lease_until<=?').bind(now+60000,...args,now).run();
    if (!claim.meta?.changes) continue;
    // No enviar pendientes de un grupo desvinculado.
    const linked=await env.DB.prepare('SELECT 1 FROM telegram_chats WHERE tenant_id=? AND chat_id=?').bind(r.tenant_id,r.chat_id).first();
    if (!linked) { await env.DB.prepare('DELETE FROM telegram_outbox WHERE tenant_id=? AND event_key=? AND chat_id=?').bind(...args).run(); continue; }
    try {
      await sendText(env,r.chat_id,r.text);
      await env.DB.prepare('UPDATE telegram_outbox SET sent_at=?,lease_until=0 WHERE tenant_id=? AND event_key=? AND chat_id=?').bind(Date.now(),...args).run();
    } catch {
      await env.DB.prepare('UPDATE telegram_outbox SET attempts=attempts+1,next_attempt=?,lease_until=0 WHERE tenant_id=? AND event_key=? AND chat_id=?').bind(now+Math.min(3600000,60000*2**Math.min(r.attempts,6)),...args).run();
    }
  }
}

export async function afterPush(env, tenantId, applied) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const chats = await chatsOf(env, tenantId);
  if (!chats.length) return;
  const cfg = await getConfig(env, tenantId), money = n => fmtMoney(n,cfg.currency);
  const messages = [], queue = (key,text) => messages.push({key,text});
  for (const {t,r} of applied) {
    if (t !== 'cash_sessions' || r.status !== 'closed' || cfg.telegram_cuts === false) continue;
    const s=typeof r.summary==='string'?JSON.parse(r.summary||'{}'):(r.summary||{});
    const diff=Number(r.counted_cash||0)-Number(r.expected_cash||0);
    queue(`cash:${r.id}`, [
      `<b>🏦 Corte de caja</b> · ${esc(cfg.name)}`,
      s.branch?`Sucursal: ${esc(s.branch)}`:'', s.closed_by?`Usuario: ${esc(s.closed_by)}`:'',
      `Fondo inicial: ${money(r.opening_amount)}`,`Ventas en efectivo: ${money(s.sales||0)}`,
      `Entradas: ${money(s.ins||0)} · Salidas: ${money(s.outs||0)}`,
      `Propinas en efectivo: ${money(s.cash_tips||0)}`,
      `<b>Esperado: ${money(r.expected_cash)}</b>`,`<b>Contado: ${money(r.counted_cash)}</b>`,
      Math.abs(diff)<0.005?'✅ Cuadra':diff>0?`⬆️ Sobrante ${money(diff)}`:`⚠️ Faltante ${money(-diff)}`,
      ...Object.entries(s.methods||{}).filter(([k])=>k!=='efectivo').map(([k,v])=>`${esc(PAY_METHODS[k]||k)}: ${money(v)}`),
      `Tickets en el turno: ${s.tickets||0} · Total vendido: ${money(s.total||0)}`,
      r.note?`Nota: ${esc(String(r.note).slice(0,400))}`:''
    ].filter(Boolean).join('\n'));
  }
  const cuts=applied.filter(c=>c.t==='cash_sessions'&&c.r.status==='closed'&&cfg.telegram_cuts!==false);
  if(cuts.length) {
    const branches=[...new Set(cuts.map(c=>c.r.branch_id))];
    const stocks=(await env.DB.prepare(`SELECT m.branch_id,p.name,p.unit,SUM(m.qty) AS qty FROM stock_moves m JOIN products p ON p.tenant_id=m.tenant_id AND p.id=m.product_id WHERE m.tenant_id=? AND m.deleted=0 AND p.deleted=0 AND p.track_stock=1 AND m.branch_id IN (${branches.map(()=>'?').join(',')}) GROUP BY m.branch_id,p.id`).bind(tenantId,...branches).all()).results || [];
    const accounts=(await env.DB.prepare(`SELECT branch_id,COUNT(*) AS n,SUM(total) AS total FROM orders WHERE tenant_id=? AND deleted=0 AND status='open' AND branch_id IN (${branches.map(()=>'?').join(',')}) GROUP BY branch_id`).bind(tenantId,...branches).all()).results || [];
    for(const {r} of cuts) {
      const message=messages.find(m=>m.key===`cash:${r.id}`), branchStocks=stocks.filter(p=>p.branch_id===r.branch_id), account=accounts.find(a=>a.branch_id===r.branch_id);
      message.text+=`\nCuentas abiertas ahora: ${account?.n||0} · Por cobrar: ${money(account?.total||0)}`;
      message.text+=branchStocks.length?`\n<b>Inventario actual</b>\n${branchStocks.slice(0,15).map(p=>`• ${esc(String(p.name).slice(0,80))}: ${fmtQty(p.qty,p.unit)}`).join('\n')}${branchStocks.length>15?'\nMás existencias: /inventario':''}`:'\nNo hay existencias registradas para esta sucursal.';
    }
  }
  const productIds=[...new Set(applied.filter(c=>c.t==='stock_moves'&&Number(c.r.qty)<0).map(c=>c.r.product_id))];
  if(productIds.length && cfg.telegram_stock !== false) {
    const rows=(await env.DB.prepare(`SELECT p.id,p.name,p.unit,p.stock_min,COALESCE(SUM(m.qty),0) AS qty
      FROM products p LEFT JOIN stock_moves m ON m.tenant_id=p.tenant_id AND m.product_id=p.id AND m.deleted=0
      WHERE p.tenant_id=? AND p.id IN (${productIds.map(()=>'?').join(',')}) AND p.track_stock=1 AND p.deleted=0 GROUP BY p.id`).bind(tenantId,...productIds).all()).results || [];
    const today=localDate(Date.now(),cfg.timezone);
    for(const p of rows) if(Number(p.qty)<=Number(p.stock_min||0)) queue(`low:${p.id}:${today}`,`<b>⚠️ Stock bajo</b> · ${esc(cfg.name)}\n• ${esc(p.name)}: quedan ${fmtQty(p.qty,p.unit)} (mínimo ${fmtQty(p.stock_min,p.unit)})`);
  }
  // El cobro puede sincronizarse en varios bloques: esperar a que los pagos cubran el total.
  const ids=[...new Set(applied.filter(c=>c.t==='payments'||(c.t==='orders'&&c.r.status==='paid')).map(c=>c.t==='payments'?c.r.order_id:c.r.id))].filter(Boolean);
  if(ids.length && cfg.telegram_sales !== false) {
    const rows=(await env.DB.prepare(`SELECT o.*,u.name AS waiter,
      (SELECT json_group_array(json_object('method',p.method,'amount',p.amount,'tip',p.tip)) FROM payments p WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id AND p.deleted=0) AS pays
      FROM orders o LEFT JOIN users u ON u.tenant_id=o.tenant_id AND u.id=o.user_id
      WHERE o.tenant_id=? AND o.deleted=0 AND o.status='paid' AND o.id IN (${ids.map(()=>'?').join(',')})
      AND COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.tenant_id=o.tenant_id AND p.order_id=o.id AND p.deleted=0),0)>=o.total-0.01`).bind(tenantId,...ids).all()).results || [];
    for(const o of rows) {
      const pays=JSON.parse(o.pays||'[]'), tips=pays.reduce((sum,p)=>sum+Number(p.tip||0),0);
      const at=new Date(o.closed_at).toLocaleString('es-MX',{timeZone:cfg.timezone});
      queue(`sale:${o.id}`,`<b>💰 Venta cobrada</b> · ${esc(cfg.name)}\nCuenta #${esc(o.number)}${o.customer?` · ${esc(String(o.customer).slice(0,150))}`:''}\n${esc(at)}\n<b>Total: ${money(o.total)}</b>\nUsuario: ${esc(String(o.waiter||'Sin asignar').slice(0,100))}\n${pays.map(p=>`• ${esc(PAY_METHODS[p.method]||p.method)}: ${money(p.amount)}`).join('\n')}${tips?`\nPropina: ${money(tips)}`:''}${o.discount?`\nDescuento: ${money(o.discount)}`:''}\nAviso del cobro sincronizado en K-POS.`);
    }
  }
  await enqueueMessages(env,tenantId,chats,messages);
  await drainOutbox(env,tenantId);
}

// ---------- Cron (cada hora) ----------

export async function scheduled(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const now=Date.now();
  const tenants=(await env.DB.prepare("SELECT DISTINCT t.id,t.name,t.slug,c.value FROM tenants t JOIN telegram_chats tg ON tg.tenant_id=t.id LEFT JOIN config c ON c.tenant_id=t.id AND c.id='business'").all()).results || [];
  const logged=(await env.DB.prepare("SELECT tenant_id,event_key FROM telegram_outbox WHERE created_at>=? AND (event_key LIKE 'daily:%' OR event_key LIKE 'progress:%') UNION SELECT tenant_id,key AS event_key FROM notify_log WHERE created_at>=? AND (key LIKE 'daily:%' OR key LIKE 'progress:%')").bind(now-2*86400000,now-2*86400000).all()).results || [];
  const known=new Set(logged.map(r=>`${r.tenant_id}|${r.event_key}`));
  let jobs=0;
  // Dos resúmenes por ejecución dejan margen dentro del límite de consultas de D1 gratuito.
  for(const tenant of tenants) {
    if(jobs>=2) break;
    try {
      const cfg={timezone:'America/Mexico_City',report_hour:8,...JSON.parse(tenant.value||'{}')};
      const today=localDate(now,cfg.timezone),hour=localHour(now,cfg.timezone);
      const due=[];
      if(hour===Number(cfg.report_hour)) due.push({key:`daily:${today}`,kind:'yesterday'});
      if((cfg.progress_hours||[]).map(Number).includes(hour)) due.push({key:`progress:${today}:${hour}`,kind:'today'});
      for(const event of due) {
        if(jobs>=2) break;
        if(known.has(`${tenant.id}|${event.key}`)) continue;
        const {text}=await buildReport(env,tenant,event.kind);
        await enqueueMessages(env,tenant.id,await chatsOf(env,tenant.id),[{key:event.key,text}]);
        known.add(`${tenant.id}|${event.key}`);jobs++;
      }
    } catch { console.error('cron',tenant.slug,'No se pudo preparar el aviso'); }
  }
  await drainOutbox(env);
}

// ---------- Webhook ----------

const HELP = [
  '<b>K-POS · comandos</b>',
  '/resumen — ventas, caja e inventario de ayer',
  '/hoy — cómo va el día',
  '/stock — productos con stock bajo',
  '/caja — cajas abiertas y efectivo esperado',
  '/vincular CÓDIGO — conectar este chat a un negocio',
  '/desvincular — dejar de recibir avisos',
].join('\n');

export async function handleWebhook(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => ({}));
  const msg = update.message || update.channel_post;
  if (!msg?.text) return new Response('ok');
  const chatId = String(msg.chat.id);
  const title = msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.username || '';
  const [rawCmd, ...args] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const reply = (text) => sendText(env, chatId, text);

  const linked = (await env.DB.prepare('SELECT t.id, t.name, t.slug FROM telegram_chats c JOIN tenants t ON t.id = c.tenant_id WHERE c.chat_id = ?').bind(chatId).all()).results || [];

  if ((cmd === '/start' && args[0]) || cmd === '/vincular') {
    const code = (args[0] || '').replace(/\D/g, '');
    const row = code && await env.DB.prepare("SELECT tenant_id FROM link_codes WHERE code = ? AND purpose = 'telegram' AND expires_at > ?").bind(code, Date.now()).first();
    if (!row) { await reply('❌ Código inválido o vencido. Genera uno nuevo en K-POS → Ajustes → Telegram.'); return new Response('ok'); }
    await env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO telegram_chats (tenant_id, chat_id, title, created_at) VALUES (?, ?, ?, ?)').bind(row.tenant_id, chatId, title, Date.now()),
      env.DB.prepare('DELETE FROM link_codes WHERE code = ?').bind(code),
    ]);
    const t = await env.DB.prepare('SELECT name FROM tenants WHERE id = ?').bind(row.tenant_id).first();
    await reply(`✅ Chat vinculado con <b>${esc(t?.name)}</b>.\nRecibirás avisos de ventas cobradas, el resumen diario, cortes de caja y stock bajo.\n\n${HELP}`);
    return new Response('ok');
  }
  if (!linked.length) {
    await reply(`👋 Hola. Este chat aún no está conectado a ningún negocio.\nEn K-POS ve a <b>Ajustes → Telegram</b>, genera un código y envía aquí:\n<code>/vincular 123456</code>`);
    return new Response('ok');
  }
  if (cmd === '/desvincular') {
    await env.DB.prepare('DELETE FROM telegram_chats WHERE chat_id = ?').bind(chatId).run();
    await reply('Listo, este chat ya no recibirá avisos.');
    return new Response('ok');
  }
  for (const tenant of linked) {
    if (cmd === '/resumen' || cmd === '/ayer') {
      await reply((await buildReport(env, tenant, 'yesterday')).text);
    } else if (cmd === '/hoy') {
      await reply((await buildReport(env, tenant, 'today')).text);
    } else if (cmd === '/stock' || cmd === '/inventario') {
      const cfg = await getConfig(env, tenant.id);
      const s = await loadSummary(env, tenant.id, { date: localDate(Date.now(), cfg.timezone), tz: cfg.timezone });
      const list = cmd === '/stock' ? s.low_stock : s.inventory;
      await reply(list.length
        ? [`<b>${cmd === '/stock' ? '⚠️ Stock bajo' : '📦 Inventario'}</b> · ${esc(cfg.name || tenant.name)}`, ...list.map((i) => `${i.low ? '🔴' : '🟢'} ${esc(i.name)}: ${fmtQty(i.qty, i.unit)}`)].join('\n')
        : `✅ ${esc(cfg.name || tenant.name)}: sin productos con stock bajo.`);
    } else if (cmd === '/caja') {
      const cfg = await getConfig(env, tenant.id);
      const s = await loadSummary(env, tenant.id, { date: localDate(Date.now(), cfg.timezone), tz: cfg.timezone });
      const open = s.cash.filter((c) => c.status === 'open');
      await reply(open.length
        ? [`<b>🏦 Cajas abiertas</b> · ${esc(cfg.name || tenant.name)}`, ...open.map((c) => `• ${esc(c.opened_by)}: fondo ${fmtMoney(c.opening, cfg.currency)}, esperado ${fmtMoney(c.expected, cfg.currency)}`)].join('\n')
        : `${esc(cfg.name || tenant.name)}: no hay cajas abiertas.`);
    } else {
      await reply(HELP);
      break;
    }
  }
  return new Response('ok');
}

