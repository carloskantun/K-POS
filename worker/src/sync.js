// Sincronización: los dispositivos suben cambios (push) y bajan lo nuevo (pull) por número de secuencia.
// Reglas de fusión:
//  - Última escritura gana por updated_at (por fila).
//  - Los estados nunca retroceden (una cuenta pagada no vuelve a "abierta", un platillo listo no vuelve a "enviado").
//  - Movimientos de inventario, pagos y movimientos de caja son solo inserción: idempotentes por id.
import { TABLES, JSON_FIELDS, INSERT_ONLY, OPERATIONAL, INITIAL_WINDOW_MS, ORDER_STATUS, ITEM_STATUS } from '../../public/js/shared/schema.js';

const BATCH = 40;
const MAX_IMAGE = 400_000;

const statusGuard = (table, list) =>
  ` AND instr(',${list.join(',')},', ',' || COALESCE(excluded.status, '') || ',') >= instr(',${list.join(',')},', ',' || COALESCE("${table}".status, '') || ',')`;

const GUARDS = {
  orders: statusGuard('orders', ORDER_STATUS),
  order_items: statusGuard('order_items', ITEM_STATUS),
  cash_sessions: statusGuard('cash_sessions', ['open', 'closed']),
};

const sqlCache = new Map();
function upsertSql(table) {
  if (sqlCache.has(table)) return sqlCache.get(table);
  const cols = ['tenant_id', 'id', 'updated_at', 'deleted', 'seq', ...TABLES[table]];
  const values = cols.map((c) => (c === 'seq' ? '(SELECT seq FROM tenants WHERE id = ?) - ?' : '?'));
  let sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')})`;
  if (INSERT_ONLY.includes(table)) {
    sql += ' ON CONFLICT (tenant_id, id) DO NOTHING';
  } else {
    const set = cols.filter((c) => c !== 'tenant_id' && c !== 'id').map((c) => `"${c}" = excluded."${c}"`);
    sql += ` ON CONFLICT (tenant_id, id) DO UPDATE SET ${set.join(', ')} WHERE excluded.updated_at >= "${table}".updated_at${GUARDS[table] || ''}`;
  }
  sqlCache.set(table, sql);
  return sql;
}

function cleanValue(table, col, v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if ((JSON_FIELDS[table] || []).includes(col)) return v === null ? null : typeof v === 'string' ? v : JSON.stringify(v);
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  if (col === 'image' && typeof v === 'string' && v.length > MAX_IMAGE) return '';
  return v;
}

export function validChange(c) {
  return c && TABLES[c.t] && c.r && typeof c.r.id === 'string' && c.r.id.length > 0 && c.r.id.length <= 80
    && Number.isFinite(Number(c.r.updated_at));
}

export async function push(env, tenantId, changes) {
  const valid = (Array.isArray(changes) ? changes : []).filter(validChange);
  const applied = [];
  const rejected = [];
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH);
    const n = chunk.length;
    const stmts = [env.DB.prepare('UPDATE tenants SET seq = seq + ? WHERE id = ?').bind(n, tenantId)];
    chunk.forEach((c, k) => {
      const r = c.r;
      const vals = [tenantId, r.id, Number(r.updated_at), r.deleted ? 1 : 0, tenantId, n - 1 - k];
      for (const col of TABLES[c.t]) vals.push(cleanValue(c.t, col, r[col]));
      stmts.push(env.DB.prepare(upsertSql(c.t)).bind(...vals));
    });
    const res = await env.DB.batch(stmts);
    chunk.forEach((c, k) => {
      const changed = res[k + 1]?.meta?.changes > 0;
      if (changed) applied.push(c);
      else if (!INSERT_ONLY.includes(c.t)) rejected.push(c);
    });
  }
  // Para las filas que el servidor no aceptó (versión más nueva o estado más avanzado), regresa la vigente.
  const current = {};
  if (rejected.length) {
    const stmts = rejected.map((c) => env.DB.prepare(`SELECT * FROM "${c.t}" WHERE tenant_id = ? AND id = ?`).bind(tenantId, c.r.id));
    const res = await env.DB.batch(stmts);
    rejected.forEach((c, k) => {
      const row = res[k]?.results?.[0];
      if (row) (current[c.t] ||= []).push(decodeRow(c.t, row));
    });
  }
  return { accepted: valid.length, applied, current };
}

export function decodeRow(table, row) {
  const out = { ...row };
  delete out.tenant_id;
  delete out.seq;
  for (const f of JSON_FIELDS[table] || []) {
    if (typeof out[f] === 'string') {
      try { out[f] = JSON.parse(out[f]); } catch { /* texto plano */ }
    }
  }
  return out;
}

export async function pull(env, tenantId, since, limit = 1000) {
  const initial = !since;
  const cutoff = Date.now() - INITIAL_WINDOW_MS;
  const tables = Object.keys(TABLES);
  const stmts = [env.DB.prepare('SELECT seq FROM tenants WHERE id = ?').bind(tenantId)];
  for (const t of tables) {
    let sql = `SELECT * FROM "${t}" WHERE tenant_id = ? AND seq > ?`;
    const args = [tenantId, since || 0];
    if (initial && OPERATIONAL.includes(t)) {
      if (t === 'orders') {
        sql += " AND (updated_at > ? OR status = 'open')";
        args.push(cutoff);
      } else if (t === 'order_items') {
        sql += " AND (updated_at > ? OR order_id IN (SELECT id FROM orders WHERE tenant_id = ? AND status = 'open'))";
        args.push(cutoff, tenantId);
      } else {
        sql += ' AND updated_at > ?';
        args.push(cutoff);
      }
    }
    sql += ' ORDER BY seq LIMIT ?';
    args.push(limit);
    stmts.push(env.DB.prepare(sql).bind(...args));
  }
  const res = await env.DB.batch(stmts);
  const tenantSeq = res[0]?.results?.[0]?.seq || 0;
  let cursor = tenantSeq;
  let more = false;
  const raw = {};
  tables.forEach((t, i) => {
    const rows = res[i + 1]?.results || [];
    raw[t] = rows;
    if (rows.length >= limit) {
      more = true;
      cursor = Math.min(cursor, rows[rows.length - 1].seq);
    }
  });
  const changes = {};
  for (const t of tables) {
    const rows = raw[t].filter((r) => r.seq <= cursor).map((r) => decodeRow(t, r));
    if (rows.length) changes[t] = rows;
  }
  const out = { changes, cursor, more };
  if (initial) {
    // Existencias a la fecha del cursor: el cliente no necesita todo el historial de movimientos.
    const st = await env.DB.prepare(
      'SELECT branch_id, product_id, SUM(qty) AS qty FROM stock_moves WHERE tenant_id = ? AND seq <= ? AND deleted = 0 GROUP BY branch_id, product_id',
    ).bind(tenantId, cursor).all();
    out.stock = st.results || [];
  }
  return out;
}

export async function stockLevels(env, tenantId) {
  const st = await env.DB.prepare(
    'SELECT branch_id, product_id, SUM(qty) AS qty FROM stock_moves WHERE tenant_id = ? AND deleted = 0 GROUP BY branch_id, product_id',
  ).bind(tenantId).all();
  return st.results || [];
}
