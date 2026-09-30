-- Extras/variantes, propinas, bitácora, administración de clientes y límites de intentos.

ALTER TABLE products ADD COLUMN modifiers TEXT;
ALTER TABLE order_items ADD COLUMN mods TEXT;
ALTER TABLE payments ADD COLUMN tip REAL;

CREATE TABLE IF NOT EXISTS audit (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  branch_id TEXT, user_id TEXT, authorized_by TEXT, action TEXT, ref_id TEXT, detail TEXT, amount REAL, created_at INTEGER,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_audit_seq ON audit (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit (tenant_id, created_at);

-- Estado comercial del cliente (lo administras tú desde /admin).
ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD COLUMN plan TEXT;
ALTER TABLE tenants ADD COLUMN paid_until INTEGER;
ALTER TABLE tenants ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
