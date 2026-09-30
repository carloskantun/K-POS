// Adaptador mínimo de la API de Cloudflare D1 sobre node:sqlite, para correr el mismo Worker
// en una computadora del negocio (servidor local) o en pruebas.
import { DatabaseSync } from 'node:sqlite';

const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

export function createD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params.map(clean));
    }
    _exec() {
      const st = db.prepare(this.sql);
      if (returnsRows(this.sql)) {
        const results = st.all(...this.params);
        return { success: true, results, meta: { changes: results.length } };
      }
      const r = st.run(...this.params);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    async all() { return this._exec(); }
    async run() { return this._exec(); }
    async first(col) {
      const row = db.prepare(this.sql).get(...this.params);
      if (!row) return null;
      return col ? row[col] : { ...row };
    }
    async raw() {
      return db.prepare(this.sql).all(...this.params).map((r) => Object.values(r));
    }
  }

  return {
    raw: db,
    prepare: (sql) => new Statement(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    },
  };
}
