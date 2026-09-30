// Exportación de ventas a CSV (para Excel / contador).
import { dayRange, shiftDate } from '../../public/js/shared/util.js';
import { toCSV } from '../../public/js/shared/csv.js';
import { PAY_METHODS } from '../../public/js/shared/schema.js';

const HEADERS = ['fecha', 'hora', 'ticket', 'cuenta', 'estado', 'producto', 'extras', 'cantidad', 'precio', 'importe', 'mesero', 'metodo_pago', 'total_ticket', 'descuento', 'propina'];

export async function exportSales(env, tenantId, { from, to, tz }) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  if (days < 0 || days > 92) return null;
  const start = dayRange(from, tz).from;
  const end = dayRange(shiftDate(to, 0), tz).to;
  const r = await env.DB.prepare(
    `SELECT o.id AS order_id, o.number, o.closed_at, o.status AS order_status, o.customer, o.total AS order_total, o.discount,
            tb.name AS table_name, u.name AS user_name,
            i.name, i.mods, i.qty, i.unit, i.price, i.total, i.status AS item_status
     FROM orders o
     JOIN order_items i ON i.tenant_id = o.tenant_id AND i.order_id = o.id AND i.deleted = 0
     LEFT JOIN tables tb ON tb.tenant_id = o.tenant_id AND tb.id = o.table_id
     LEFT JOIN users u ON u.tenant_id = o.tenant_id AND u.id = o.user_id
     WHERE o.tenant_id = ? AND o.deleted = 0 AND o.status IN ('paid', 'cancelled') AND o.closed_at >= ? AND o.closed_at < ?
     ORDER BY o.closed_at, o.id`,
  ).bind(tenantId, start, end).all();
  const pays = await env.DB.prepare(
    `SELECT p.order_id, p.method, p.amount, p.tip FROM payments p JOIN orders o ON o.tenant_id = p.tenant_id AND o.id = p.order_id
     WHERE p.tenant_id = ? AND o.closed_at >= ? AND o.closed_at < ?`,
  ).bind(tenantId, start, end).all();
  const byOrder = new Map();
  for (const p of pays.results || []) {
    const cur = byOrder.get(p.order_id) || { methods: new Set(), tip: 0 };
    cur.methods.add(PAY_METHODS[p.method] || p.method);
    cur.tip += Number(p.tip) || 0;
    byOrder.set(p.order_id, cur);
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const seen = new Set();
  const rows = (r.results || []).map((x) => {
    const first = !seen.has(x.order_id);
    seen.add(x.order_id);
    let mods = '';
    try { mods = (JSON.parse(x.mods || '[]') || []).map((m) => m.name).join(', '); } catch { mods = ''; }
    const p = byOrder.get(x.order_id);
    return {
      fecha: date.format(new Date(x.closed_at)), hora: time.format(new Date(x.closed_at)), ticket: x.number,
      cuenta: [x.table_name, x.customer].filter(Boolean).join(' · '),
      estado: x.item_status === 'cancelled' || x.order_status === 'cancelled' ? 'cancelado' : 'pagado',
      producto: x.name, extras: mods, cantidad: x.qty, precio: x.price, importe: x.total, mesero: x.user_name || '',
      metodo_pago: p ? [...p.methods].join(' + ') : '',
      total_ticket: first ? x.order_total : '', descuento: first && x.discount ? x.discount : '', propina: first && p?.tip ? p.tip : '',
    };
  });
  return toCSV(rows, HEADERS);
}
