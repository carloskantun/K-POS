import { computeSummary } from '../../public/js/shared/report.js';
import { dayRange, localDate, shiftDate, fmtMoney, fmtQty } from '../../public/js/shared/util.js';
import { PAY_METHODS } from '../../public/js/shared/schema.js';
import { decodeRow, stockLevels } from './sync.js';

export async function getConfig(env, tenantId) {
  const row = await env.DB.prepare("SELECT value FROM config WHERE tenant_id = ? AND id = 'business'").bind(tenantId).first();
  let cfg = {};
  try { cfg = row?.value ? JSON.parse(row.value) : {}; } catch { cfg = {}; }
  return { timezone: 'America/Mexico_City', currency: 'MXN', report_hour: 8, progress_hours: [], ...cfg };
}

const all = async (stmt, table) => ((await stmt.all()).results || []).map((r) => decodeRow(table, r));

export async function loadSummary(env, tenantId, { date, tz, branchId = null }) {
  const { from, to } = dayRange(date, tz);
  const DB = env.DB;
  const orderFilter = "tenant_id = ? AND deleted = 0 AND ((closed_at >= ? AND closed_at < ?) OR status = 'open')";
  const [orders, items, payments, sessions, cashMoves, products, users, branches, stock, audit] = await Promise.all([
    all(DB.prepare(`SELECT * FROM orders WHERE ${orderFilter}`).bind(tenantId, from, to), 'orders'),
    all(DB.prepare(`SELECT * FROM order_items WHERE tenant_id = ? AND (order_id IN (SELECT id FROM orders WHERE ${orderFilter}) OR (status = 'cancelled' AND updated_at >= ? AND updated_at < ?))`).bind(tenantId, tenantId, from, to, from, to), 'order_items'),
    all(DB.prepare(`SELECT * FROM payments WHERE tenant_id = ? AND (order_id IN (SELECT id FROM orders WHERE tenant_id = ? AND closed_at >= ? AND closed_at < ?) OR cash_session_id IN (SELECT id FROM cash_sessions WHERE tenant_id = ? AND (status = 'open' OR (closed_at >= ? AND closed_at < ?))))`).bind(tenantId, tenantId, from, to, tenantId, from, to), 'payments'),
    all(DB.prepare("SELECT * FROM cash_sessions WHERE tenant_id = ? AND (status = 'open' OR (closed_at >= ? AND closed_at < ?))").bind(tenantId, from, to), 'cash_sessions'),
    all(DB.prepare("SELECT * FROM cash_moves WHERE tenant_id = ? AND cash_session_id IN (SELECT id FROM cash_sessions WHERE tenant_id = ? AND (status = 'open' OR (closed_at >= ? AND closed_at < ?)))").bind(tenantId, tenantId, from, to), 'cash_moves'),
    all(DB.prepare('SELECT id, name, unit, track_stock, stock_min, active, deleted, sellable FROM products WHERE tenant_id = ?').bind(tenantId), 'products'),
    all(DB.prepare('SELECT id, name, role, deleted FROM users WHERE tenant_id = ?').bind(tenantId), 'users'),
    all(DB.prepare('SELECT id, name, deleted FROM branches WHERE tenant_id = ?').bind(tenantId), 'branches'),
    stockLevels(env, tenantId),
    all(DB.prepare('SELECT * FROM audit WHERE tenant_id = ? AND created_at >= ? AND created_at < ?').bind(tenantId, from, to), 'audit'),
  ]);
  const summary = computeSummary(
    { orders, order_items: items, payments, cash_sessions: sessions, cash_moves: cashMoves, products, users, stock, audit, tz },
    { from, to, branchId },
  );
  summary.date = date;
  summary.branches = branches.filter((b) => !b.deleted).map((b) => ({ id: b.id, name: b.name }));
  return summary;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Mensaje HTML para Telegram.
export function formatSummary(s, { businessName, currency = 'MXN', title }) {
  const m = (n) => fmtMoney(n, currency);
  const L = [];
  L.push(`<b>${esc(title)}</b> · ${esc(businessName)}`);
  L.push(`📅 ${s.date}`);
  L.push('');
  L.push(`💰 <b>Ventas: ${m(s.total)}</b>`);
  L.push(`🧾 Tickets: ${s.tickets} · Promedio: ${m(s.average)}`);
  for (const [k, v] of Object.entries(s.by_method)) L.push(`   • ${esc(PAY_METHODS[k] || k)}: ${m(v)}`);
  if (s.tips) L.push(`🤝 Propinas: ${m(s.tips)}`);
  if (s.discount) L.push(`🏷️ Descuentos: ${m(s.discount)}`);
  if (s.cancelled_orders || s.cancelled_items) L.push(`❌ Cancelaciones: ${s.cancelled_orders} cuentas, ${s.cancelled_items} productos (${m(s.cancelled_amount)})`);
  if (s.open_orders) L.push(`🕒 Cuentas abiertas ahora: ${s.open_orders}`);

  if (s.by_product.length) {
    L.push('');
    L.push('<b>🏆 Más vendidos</b>');
    s.by_product.slice(0, 8).forEach((p, i) => L.push(`${i + 1}. ${esc(p.name)} × ${fmtQty(p.qty, p.unit)} — ${m(p.total)}`));
  }
  if (s.by_user.length > 1) {
    L.push('');
    L.push('<b>👤 Por usuario</b>');
    s.by_user.forEach((u) => L.push(`• ${esc(u.name)}: ${u.tickets} tickets — ${m(u.total)}${u.tips ? ` (propinas ${m(u.tips)})` : ''}`));
  }
  const sensitive = (s.audit || []).filter((a) => a.action !== 'stock_adjust');
  if (sensitive.length) {
    L.push('');
    L.push('<b>🔒 Cancelaciones y descuentos</b>');
    const labels = { cancel_item: 'Canceló', cancel_order: 'Canceló cuenta', discount: 'Descuento', cash_out: 'Salida', reopen: 'Reabrió' };
    sensitive.slice(0, 15).forEach((a) => L.push(`• ${esc(labels[a.action] || a.action)} ${a.amount ? m(a.amount) : ''} — ${esc(a.detail)} (${esc(a.user)}${a.authorized && a.authorized !== a.user ? `, autorizó ${esc(a.authorized)}` : ''})`));
    if (sensitive.length > 15) L.push(`… y ${sensitive.length - 15} más`);
  }
  if (s.cash.length) {
    L.push('');
    L.push('<b>🏦 Caja</b>');
    for (const c of s.cash) {
      if (c.status === 'closed') {
        const tag = c.diff === 0 ? '✅ cuadra' : c.diff > 0 ? `⬆️ sobrante ${m(c.diff)}` : `⚠️ faltante ${m(-c.diff)}`;
        L.push(`• Corte (${esc(c.closed_by || c.opened_by)}): esperado ${m(c.expected)}, contado ${m(c.counted)} → ${tag}`);
      } else {
        L.push(`• Caja abierta (${esc(c.opened_by)}): debe haber ${m(c.expected)} en efectivo`);
      }
    }
  }
  if (s.low_stock.length) {
    L.push('');
    L.push('<b>⚠️ Stock bajo</b>');
    s.low_stock.slice(0, 20).forEach((i) => L.push(`• ${esc(i.name)}: quedan ${fmtQty(i.qty, i.unit)} (mín. ${fmtQty(i.min, i.unit)})`));
  }
  const ok = s.inventory.filter((i) => !i.low);
  if (ok.length) {
    L.push('');
    L.push('<b>📦 Inventario</b>');
    ok.slice(0, 25).forEach((i) => L.push(`• ${esc(i.name)}: ${fmtQty(i.qty, i.unit)}`));
    if (ok.length > 25) L.push(`… y ${ok.length - 25} productos más`);
  }
  return L.join('\n');
}

export async function buildReport(env, tenant, kind = 'yesterday') {
  const cfg = await getConfig(env, tenant.id);
  const today = localDate(Date.now(), cfg.timezone);
  const date = kind === 'yesterday' ? shiftDate(today, -1) : today;
  const s = await loadSummary(env, tenant.id, { date, tz: cfg.timezone });
  const title = kind === 'yesterday' ? '📊 Resumen de ayer' : '📈 Cómo va hoy';
  return { text: formatSummary(s, { businessName: cfg.name || tenant.name, currency: cfg.currency, title }), summary: s, cfg };
}
