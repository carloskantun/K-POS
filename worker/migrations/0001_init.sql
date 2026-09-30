-- K-POS: esquema multi-negocio (un solo D1, cada fila lleva tenant_id).

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  business_type TEXT,
  owner_email TEXT NOT NULL,
  owner_pass TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_chats (
  tenant_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, chat_id)
);

-- Evita mandar dos veces el mismo aviso (reintentos del cron, alertas de stock por día).
CREATE TABLE IF NOT EXISTS notify_log (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

-- ---------- Tablas sincronizadas (ver public/js/shared/schema.js) ----------

CREATE TABLE IF NOT EXISTS config (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS branches (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  name TEXT, address TEXT, active INTEGER,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS users (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  name TEXT, role TEXT, pin_hash TEXT, color TEXT, active INTEGER, branch_id TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS categories (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  name TEXT, color TEXT, emoji TEXT, sort INTEGER, active INTEGER,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS products (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  category_id TEXT, name TEXT, price REAL, price_wholesale REAL, wholesale_min REAL, cost REAL, unit TEXT,
  barcode TEXT, image TEXT, emoji TEXT, station TEXT, track_stock INTEGER, stock_min REAL, recipe TEXT,
  sort INTEGER, active INTEGER, sellable INTEGER,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS tables (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  branch_id TEXT, name TEXT, zone TEXT, sort INTEGER, active INTEGER,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS orders (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  branch_id TEXT, number INTEGER, table_id TEXT, user_id TEXT, customer TEXT, status TEXT, kind TEXT,
  subtotal REAL, discount REAL, total REAL, opened_at INTEGER, closed_at INTEGER, cash_session_id TEXT,
  device_id TEXT, note TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS order_items (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  order_id TEXT, branch_id TEXT, product_id TEXT, name TEXT, qty REAL, unit TEXT, price REAL, total REAL,
  note TEXT, station TEXT, status TEXT, sent_at INTEGER, ready_at INTEGER, user_id TEXT, cancel_reason TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS payments (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  order_id TEXT, branch_id TEXT, method TEXT, amount REAL, received REAL, change_given REAL,
  cash_session_id TEXT, user_id TEXT, created_at INTEGER,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS stock_moves (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  branch_id TEXT, product_id TEXT, qty REAL, kind TEXT, ref_id TEXT, note TEXT, user_id TEXT,
  created_at INTEGER, cost REAL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  branch_id TEXT, opened_by TEXT, opened_at INTEGER, opening_amount REAL, closed_by TEXT, closed_at INTEGER,
  counted_cash REAL, expected_cash REAL, status TEXT, note TEXT, summary TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS cash_moves (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  cash_session_id TEXT, branch_id TEXT, kind TEXT, amount REAL, reason TEXT, user_id TEXT, created_at INTEGER,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_config_seq ON config (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_branches_seq ON branches (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_users_seq ON users (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_categories_seq ON categories (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_products_seq ON products (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_tables_seq ON tables (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_orders_seq ON orders (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_order_items_seq ON order_items (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_payments_seq ON payments (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_stock_moves_seq ON stock_moves (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_seq ON cash_sessions (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_cash_moves_seq ON cash_moves (tenant_id, seq);

CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders (tenant_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_product ON stock_moves (tenant_id, product_id);
