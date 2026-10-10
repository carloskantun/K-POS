// Cálculo del resumen de ventas / caja / inventario. Mismo código en la PWA (datos locales)
// y en el Worker (datos de D1) para que el reporte de Telegram cuadre con lo que ve el dueño.
import { localDate } from './util.js';
import { round2, round3 } from './util.js';

const live = (r) => r && !r.deleted;

export function computeSummary(data, { from, to, branchId = null }) {
  const inBranch = (r) => !branchId || r.branch_id === branchId;
  const inRange = (t) => t >= from && t < to;
  const orders = (data.orders || []).filter((o) => live(o) && inBranch(o));
  const paid = orders.filter((o) => o.status === 'paid' && inRange(o.closed_at));
  const paidIds = new Set(paid.map((o) => o.id));
  const cancelled = orders.filter((o) => o.status === 'cancelled' && inRange(o.closed_at || o.updated_at));
  const products = new Map((data.products || []).map((p) => [p.id, p]));
  const users = new Map((data.users || []).map((u) => [u.id, u]));

  const total = round2(paid.reduce((s, o) => s + (Number(o.total) || 0), 0));
  const discount = round2(paid.reduce((s, o) => s + (Number(o.discount) || 0), 0));

  const byMethod = {};
  const orderById = new Map(paid.map((o) => [o.id, o]));
  const tipsByUser = new Map();
  let tips = 0;
  for (const p of data.payments || []) {
    if (!live(p) || !paidIds.has(p.order_id)) continue;
    byMethod[p.method] = round2((byMethod[p.method] || 0) + Number(p.amount || 0));
    const tip = Number(p.tip) || 0;
    if (tip) {
      tips += tip;
      const uid = orderById.get(p.order_id)?.user_id;
      tipsByUser.set(uid, round2((tipsByUser.get(uid) || 0) + tip));
    }
  }

  const prod = new Map();
  let cancelledItems = 0;
  let cancelledAmount = 0;
  for (const it of data.order_items || []) {
    if (!live(it)) continue;
    if (it.status === 'cancelled') {
      if (it.sent_at && inRange(it.updated_at) && inBranch(it)) {
        cancelledItems += 1;
        cancelledAmount += Number(it.total) || 0;
      }
      continue;
    }
    if (!paidIds.has(it.order_id)) continue;
    const key = it.product_id || it.name;
    const cur = prod.get(key) || { product_id: it.product_id, name: products.get(it.product_id)?.name || it.name, qty: 0, total: 0, unit: it.unit };
    cur.qty = round3(cur.qty + Number(it.qty || 0));
    cur.total = round2(cur.total + Number(it.total || 0));
    prod.set(key, cur);
  }
  const byProduct = [...prod.values()].sort((a, b) => b.total - a.total);

  const us = new Map();
  for (const o of paid) {
    const cur = us.get(o.user_id) || { user_id: o.user_id, name: users.get(o.user_id)?.name || '—', tickets: 0, total: 0 };
    cur.tickets += 1;
    cur.total = round2(cur.total + Number(o.total || 0));
    us.set(o.user_id, cur);
  }
  for (const u of us.values()) u.tips = tipsByUser.get(u.user_id) || 0;
  const byUser = [...us.values()].sort((a, b) => b.total - a.total);

  // Bitácora: cancelaciones, descuentos y otras acciones autorizadas en el rango.
  const audit = (data.audit || []).filter((a) => live(a) && inBranch(a) && inRange(a.created_at))
    .sort((a, b) => a.created_at - b.created_at)
    .map((a) => ({ ...a, user: users.get(a.user_id)?.name || '', authorized: users.get(a.authorized_by)?.name || '' }));

  const byDay = {};
  for (const o of paid) { const date = localDate(o.closed_at, data.tz || 'UTC'); byDay[date] = round2((byDay[date] || 0) + Number(o.total || 0)); }
  const hours = new Array(24).fill(0);
  if (data.tz) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: data.tz, hour: '2-digit', hourCycle: 'h23' });
    for (const o of paid) hours[+fmt.format(new Date(o.closed_at)) % 24] += Number(o.total) || 0;
  }

  // Caja: cortes cerrados en el rango y cajas abiertas en este momento.
  const cash = [];
  for (const s of data.cash_sessions || []) {
    if (!live(s) || !inBranch(s)) continue;
    const closedInRange = s.status === 'closed' && inRange(s.closed_at);
    if (!closedInRange && s.status !== 'open') continue;
    const exp = s.status === 'open' ? expectedCash(s, data) : { expected: Number(s.expected_cash) || 0 };
    cash.push({
      id: s.id, branch_id: s.branch_id, status: s.status, opened_at: s.opened_at, closed_at: s.closed_at,
      opened_by: users.get(s.opened_by)?.name || '', closed_by: users.get(s.closed_by)?.name || '',
      opening: Number(s.opening_amount) || 0, expected: round2(exp.expected),
      counted: s.status === 'closed' ? Number(s.counted_cash) || 0 : null,
      diff: s.status === 'closed' ? round2((Number(s.counted_cash) || 0) - (Number(s.expected_cash) || 0)) : null,
    });
  }

  // Inventario: existencias actuales de productos que controlan stock.
  const stock = stockMap(data.stock || [], branchId);
  const inventory = [];
  for (const p of products.values()) {
    if (!live(p) || !p.track_stock || p.active === 0) continue;
    const qty = round3(stock.get(p.id) || 0);
    inventory.push({ product_id: p.id, name: p.name, unit: p.unit, qty, min: Number(p.stock_min) || 0, low: qty <= (Number(p.stock_min) || 0) });
  }
  inventory.sort((a, b) => (b.low - a.low) || a.name.localeCompare(b.name));

  return {
    from, to, total, discount, tickets: paid.length,
    average: paid.length ? round2(total / paid.length) : 0,
    cancelled_orders: cancelled.length,
    cancelled_items: cancelledItems, cancelled_amount: round2(cancelledAmount),
    open_orders: orders.filter((o) => o.status === 'open').length,
    open_balance: round2(orders.filter(o => o.status === 'open').reduce((sum,o) => sum + Number(o.total || 0),0)),
    occupied_tables: new Set(orders.filter(o => o.status === 'open' && o.table_id).map(o => o.table_id)).size,
    by_day: byDay,
    by_method: byMethod, by_product: byProduct, by_user: byUser, by_hour: hours.map(round2),
    tips: round2(tips), audit,
    cash, inventory, low_stock: inventory.filter((i) => i.low),
  };
}

export function stockMap(levels, branchId = null) {
  const m = new Map();
  for (const s of levels) {
    if (branchId && s.branch_id !== branchId) continue;
    m.set(s.product_id, (m.get(s.product_id) || 0) + Number(s.qty || 0));
  }
  return m;
}

// Efectivo esperado en una caja: fondo + cobros en efectivo + entradas − salidas.
export function expectedCash(session, data) {
  let sales = 0;
  let tips = 0;
  let cashTips = 0;
  const methods = {};
  for (const p of data.payments || []) {
    if (!live(p) || p.cash_session_id !== session.id) continue;
    methods[p.method] = round2((methods[p.method] || 0) + Number(p.amount || 0));
    tips += Number(p.tip) || 0;
    if (p.method === 'efectivo') {
      sales += Number(p.amount || 0);
      cashTips += Number(p.tip) || 0;
    }
  }
  let ins = 0;
  let outs = 0;
  for (const m of data.cash_moves || []) {
    if (!live(m) || m.cash_session_id !== session.id) continue;
    if (m.kind === 'in') ins += Number(m.amount || 0);
    else outs += Number(m.amount || 0);
  }
  const opening = Number(session.opening_amount) || 0;
  return {
    opening, sales: round2(sales), ins: round2(ins), outs: round2(outs), methods,
    tips: round2(tips), cash_tips: round2(cashTips),
    // Las propinas en efectivo entran al cajón hasta que se reparten (registrar como salida).
    expected: round2(opening + sales + cashTips + ins - outs),
  };
}
