// Lógica de cuentas, comandas, cobro e inventario.
import { S, get, list, save, branchId, mod, setMeta, openCashSession } from './store.js';
import { uid, round2, round3 } from './shared/util.js';

export const liveItems = (orderId) => list('order_items', (i) => i.order_id === orderId && i.status !== 'cancelled');
export const allItems = (orderId) => list('order_items', (i) => i.order_id === orderId).sort((a, b) => (a.sent_at || a.updated_at) - (b.sent_at || b.updated_at));

export function openOrders(b = branchId()) {
  return list('orders', (o) => o.status === 'open' && o.branch_id === b).sort((a, b2) => a.opened_at - b2.opened_at);
}

export function orderForTable(tableId) {
  return openOrders().find((o) => o.table_id === tableId) || null;
}

export function priceFor(p, q) {
  if (mod('wholesale') && p.price_wholesale && p.wholesale_min && q >= p.wholesale_min) return Number(p.price_wholesale);
  return Number(p.price) || 0;
}

export function orderTitle(o) {
  if (!o) return '';
  const t = o.table_id && get('tables', o.table_id);
  if (t) return t.name + (o.customer ? ` · ${o.customer}` : '');
  return o.customer || `Cuenta #${o.number}`;
}

function recalc(order, items) {
  const subtotal = round2(items.filter((i) => !i.deleted && i.status !== 'cancelled').reduce((s, i) => s + Number(i.total || 0), 0));
  order.subtotal = subtotal;
  order.total = round2(Math.max(0, subtotal - (Number(order.discount) || 0)));
  return order;
}

// Filas a guardar junto con la cuenta recalculada.
function withOrder(order, changedItems) {
  const map = new Map(liveItems(order.id).map((i) => [i.id, i]));
  for (const i of changedItems) map.set(i.id, i);
  recalc(order, [...map.values()]);
  return [['orders', { ...order }], ...changedItems.map((i) => ['order_items', i])];
}

export async function createOrder({ table_id = null, customer = '', kind = null } = {}) {
  const counter = (S.meta.counter || 0) + 1;
  await setMeta('counter', counter);
  const now = Date.now();
  const o = {
    id: uid(), branch_id: branchId(), number: counter, table_id, user_id: S.user?.id, customer,
    status: 'open', kind: kind || (table_id ? 'mesa' : 'mostrador'), subtotal: 0, discount: 0, total: 0,
    opened_at: now, closed_at: null, cash_session_id: null, device_id: S.meta.device?.id, note: '',
  };
  await save([['orders', o]]);
  return o;
}

export async function addItem(order, p, q = 1, { note = '' } = {}) {
  const same = liveItems(order.id).find((i) => i.product_id === p.id && i.status === 'new' && !i.note && !note);
  let item;
  if (same) {
    const nq = round3(Number(same.qty) + q);
    const price = priceFor(p, nq);
    item = { ...same, qty: nq, price, total: round2(nq * price) };
  } else {
    const price = priceFor(p, q);
    item = {
      id: uid(), order_id: order.id, branch_id: order.branch_id, product_id: p.id, name: p.name, qty: q,
      unit: p.unit || 'pza', price, total: round2(q * price), note, station: p.station || '', status: 'new',
      sent_at: null, ready_at: null, user_id: S.user?.id, cancel_reason: null,
    };
  }
  await save(withOrder(order, [item]));
  return item;
}

export async function setItemQty(order, item, q) {
  if (item.status !== 'new') return;
  const p = get('products', item.product_id);
  if (q <= 0) return save(withOrder(order, [{ ...item, deleted: 1 }]));
  const price = p ? priceFor(p, q) : item.price;
  return save(withOrder(order, [{ ...item, qty: round3(q), price, total: round2(q * price) }]));
}

export async function setItemNote(order, item, note) {
  return save(withOrder(order, [{ ...item, note }]));
}

function stockMoves(item, sign, suffix = '') {
  const p = get('products', item.product_id);
  if (!p) return [];
  const now = Date.now();
  const mk = (prodId, q, id) => ({
    id, branch_id: item.branch_id, product_id: prodId, qty: round3(sign * q), kind: sign < 0 ? 'sale' : 'return',
    ref_id: item.id, note: '', user_id: S.user?.id || null, created_at: now, cost: 0,
  });
  const out = [];
  if (p.track_stock) out.push(mk(p.id, Number(item.qty), `sm-${item.id}${suffix}`));
  if (mod('recipes')) {
    for (const c of p.recipe || []) {
      const cp = get('products', c.product_id);
      if (cp?.track_stock && c.qty > 0) out.push(mk(cp.id, Number(c.qty) * Number(item.qty), `sm-${item.id}-${cp.id}${suffix}`));
    }
  }
  return out;
}

// Confirma los productos nuevos: van a cocina/barra (si aplica) y se descuentan del inventario.
function commitRows(order, { forceServed = false } = {}) {
  const now = Date.now();
  const rows = [];
  const kitchen = mod('kitchen');
  for (const i of liveItems(order.id)) {
    if (i.status !== 'new') continue;
    const toKitchen = kitchen && i.station && !forceServed;
    rows.push(['order_items', { ...i, status: toKitchen ? 'sent' : 'served', sent_at: now, ready_at: toKitchen ? null : now }]);
    for (const m of stockMoves(i, -1)) rows.push(['stock_moves', m]);
  }
  return rows;
}

export const newItems = (order) => liveItems(order.id).filter((i) => i.status === 'new');

export async function sendOrder(order, { customer } = {}) {
  const rows = commitRows(order);
  const o = { ...order };
  if (customer != null) o.customer = customer;
  if (o.kind === 'mostrador') o.kind = 'cuenta';
  await save([['orders', o], ...rows]);
  return rows.filter((r) => r[0] === 'order_items').length;
}

export async function payOrder(order, payments) {
  const now = Date.now();
  const session = openCashSession(order.branch_id);
  const rows = commitRows(order);
  for (const p of payments) {
    rows.push(['payments', {
      id: uid(), order_id: order.id, branch_id: order.branch_id, method: p.method, amount: round2(p.amount),
      received: round2(p.received ?? p.amount), change_given: round2(p.change || 0),
      cash_session_id: session?.id || null, user_id: S.user?.id, created_at: now,
    }]);
  }
  const o = { ...order, status: 'paid', closed_at: now, cash_session_id: session?.id || null };
  if (!o.user_id) o.user_id = S.user?.id;
  await save([['orders', o], ...rows]);
  return o;
}

// Cancela un producto ya enviado. Si returnStock, regresa al inventario lo descontado.
export async function cancelItem(order, item, { reason = '', returnStock = true } = {}) {
  const rows = [];
  if (item.status !== 'new' && returnStock) {
    for (const m of stockMoves(item, +1, '-r')) rows.push(['stock_moves', m]);
  }
  const updated = item.status === 'new' ? { ...item, deleted: 1 } : { ...item, status: 'cancelled', cancel_reason: reason };
  await save([...withOrder(order, [updated]), ...rows]);
}

export async function cancelOrder(order, { reason = '', returnStock = true } = {}) {
  const rows = [];
  for (const i of liveItems(order.id)) {
    if (i.status === 'new') { rows.push(['order_items', { ...i, deleted: 1 }]); continue; }
    rows.push(['order_items', { ...i, status: 'cancelled', cancel_reason: reason }]);
    if (returnStock) {
      for (const m of stockMoves(i, +1, '-r')) rows.push(['stock_moves', m]);
    }
  }
  await save([['orders', { ...order, status: 'cancelled', closed_at: Date.now(), note: reason }], ...rows]);
}

export async function discardIfEmpty(order) {
  if (order && order.status === 'open' && !liveItems(order.id).length) {
    await save([['orders', { ...order, deleted: 1 }]]);
    return true;
  }
  return false;
}

export async function setItemStatus(item, status) {
  const now = Date.now();
  const u = { ...item, status };
  if (status === 'ready') u.ready_at = now;
  await save([['order_items', u]]);
}

export async function stockMove({ product, qty, kind, note = '', cost = null }) {
  await save([['stock_moves', {
    id: uid(), branch_id: branchId(), product_id: product.id, qty: round3(qty), kind, ref_id: null, note,
    user_id: S.user?.id || null, created_at: Date.now(), cost: cost ?? product.cost ?? 0,
  }]]);
}
