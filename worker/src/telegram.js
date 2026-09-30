// Bot de Telegram: resúmenes diarios, avisos de corte de caja y de stock bajo.
import { buildReport, getConfig, loadSummary } from './reports.js';
import { localDate, localHour, fmtMoney, fmtQty } from '../../public/js/shared/util.js';
import { PAY_METHODS } from '../../public/js/shared/schema.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function tgCall(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: 'TELEGRAM_BOT_TOKEN no configurado' };
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ ok: false }));
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
    await tgCall(env, 'sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true });
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

// true si es la primera vez que se registra esta clave (para no repetir avisos).
async function once(env, tenantId, key) {
  const r = await env.DB.prepare('INSERT OR IGNORE INTO notify_log (tenant_id, key, created_at) VALUES (?, ?, ?)')
    .bind(tenantId, key, Date.now()).run();
  return (r.meta?.changes || 0) > 0;
}

// ---------- Avisos al sincronizar ----------

export async function afterPush(env, tenantId, applied) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const chats = await chatsOf(env, tenantId);
  if (!chats.length) return;
  const cfg = await getConfig(env, tenantId);
  const money = (n) => fmtMoney(n, cfg.currency);
  const msgs = [];

  for (const c of applied) {
    if (c.t !== 'cash_sessions' || c.r.status !== 'closed') continue;
    if (!(await once(env, tenantId, `cash:${c.r.id}`))) continue;
    const s = typeof c.r.summary === 'string' ? JSON.parse(c.r.summary || '{}') : (c.r.summary || {});
    const diff = Number(c.r.counted_cash || 0) - Number(c.r.expected_cash || 0);
    const tag = Math.abs(diff) < 0.005 ? '✅ Cuadra' : diff > 0 ? `⬆️ Sobrante ${money(diff)}` : `⚠️ Faltante ${money(-diff)}`;
    const L = [
      `<b>🏦 Corte de caja</b> · ${esc(cfg.name || '')}`,
      s.branch ? `🏪 ${esc(s.branch)}` : '',
      s.closed_by ? `👤 ${esc(s.closed_by)}` : '',
      '',
      `Fondo inicial: ${money(c.r.opening_amount)}`,
      `Ventas en efectivo: ${money(s.sales || 0)}`,
      s.ins ? `Entradas: ${money(s.ins)}` : '',
      s.outs ? `Salidas: ${money(s.outs)}` : '',
      `<b>Esperado: ${money(c.r.expected_cash)}</b>`,
      `<b>Contado: ${money(c.r.counted_cash)}</b>`,
      tag,
    ];
    for (const [k, v] of Object.entries(s.methods || {})) {
      if (k !== 'efectivo') L.push(`${esc(PAY_METHODS[k] || k)}: ${money(v)}`);
    }
    if (s.tickets != null) L.push(`🧾 Tickets en el turno: ${s.tickets} · Total vendido: ${money(s.total || 0)}`);
    if (c.r.note) L.push(`📝 ${esc(c.r.note)}`);
    msgs.push(L.filter((x) => x !== '').join('\n'));
  }

  const productIds = [...new Set(applied.filter((c) => c.t === 'stock_moves' && Number(c.r.qty) < 0).map((c) => c.r.product_id))];
  if (productIds.length) {
    const marks = productIds.map(() => '?').join(',');
    const r = await env.DB.prepare(
      `SELECT p.id, p.name, p.unit, p.stock_min, COALESCE(SUM(m.qty), 0) AS qty
       FROM products p LEFT JOIN stock_moves m ON m.tenant_id = p.tenant_id AND m.product_id = p.id AND m.deleted = 0
       WHERE p.tenant_id = ? AND p.id IN (${marks}) AND p.track_stock = 1 AND p.deleted = 0
       GROUP BY p.id`,
    ).bind(tenantId, ...productIds).all();
    const today = localDate(Date.now(), cfg.timezone);
    const low = [];
    for (const p of r.results || []) {
      if (Number(p.qty) > Number(p.stock_min || 0)) continue;
      if (await once(env, tenantId, `low:${p.id}:${today}`)) low.push(p);
    }
    if (low.length) {
      msgs.push(['<b>⚠️ Stock bajo</b>', ...low.map((p) => `• ${esc(p.name)}: quedan ${fmtQty(p.qty, p.unit)} (mínimo ${fmtQty(p.stock_min, p.unit)})`)].join('\n'));
    }
  }

  for (const text of msgs) for (const c of chats) await sendText(env, c.chat_id, text);
}

// ---------- Cron (cada hora) ----------

export async function scheduled(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const r = await env.DB.prepare('SELECT DISTINCT t.id, t.name, t.slug FROM tenants t JOIN telegram_chats c ON c.tenant_id = t.id').all();
  for (const tenant of r.results || []) {
    try {
      const cfg = await getConfig(env, tenant.id);
      const now = Date.now();
      const hour = localHour(now, cfg.timezone);
      const today = localDate(now, cfg.timezone);
      if (hour === Number(cfg.report_hour) && (await once(env, tenant.id, `daily:${today}`))) {
        const { text } = await buildReport(env, tenant, 'yesterday');
        await sendToTenant(env, tenant.id, text);
      }
      const progress = (cfg.progress_hours || []).map(Number);
      if (progress.includes(hour) && (await once(env, tenant.id, `progress:${today}:${hour}`))) {
        const { text } = await buildReport(env, tenant, 'today');
        await sendToTenant(env, tenant.id, text);
      }
    } catch (e) {
      console.error('cron', tenant.slug, e);
    }
  }
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
  if (env.TELEGRAM_WEBHOOK_SECRET && request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
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
    await reply(`✅ Chat vinculado con <b>${esc(t?.name)}</b>.\nRecibirás el resumen diario, cortes de caja y avisos de stock bajo.\n\n${HELP}`);
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

