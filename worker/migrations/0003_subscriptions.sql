-- Administración comercial del proveedor, fuera de la sincronización del POS.
CREATE TABLE subscription_plans (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 price_cents INTEGER, cycle TEXT NOT NULL, includes TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
ALTER TABLE tenants ADD COLUMN plan_id TEXT;
ALTER TABLE tenants ADD COLUMN price_cents INTEGER;
ALTER TABLE tenants ADD COLUMN billing_cycle TEXT;
ALTER TABLE tenants ADD COLUMN plan_includes TEXT;
ALTER TABLE tenants ADD COLUMN contact_phone TEXT;
ALTER TABLE tenants ADD COLUMN service_start INTEGER;
ALTER TABLE tenants ADD COLUMN trial_until INTEGER;
ALTER TABLE tenants ADD COLUMN next_charge_at INTEGER;
CREATE TABLE subscription_charges (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), concept TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), due_at INTEGER NOT NULL,
 period_start INTEGER, period_end INTEGER, created_at INTEGER NOT NULL,
 voided_at INTEGER, void_reason TEXT
);
CREATE INDEX subscription_charges_tenant ON subscription_charges(tenant_id, due_at);
CREATE TABLE subscription_receipts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), charge_id TEXT NOT NULL REFERENCES subscription_charges(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), paid_at INTEGER NOT NULL,
 method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
 voided_at INTEGER, void_reason TEXT
);
CREATE INDEX subscription_receipts_charge ON subscription_receipts(charge_id);
