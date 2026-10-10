-- Habilita repartos solamente en grupos originales de alitas, preservando precios y opciones.
UPDATE products SET modifiers=json_set(modifiers,'$[0].type','allocation','$[0].total',
  CASE id WHEN 'rockalitas-menu-alitas-10' THEN 10 WHEN 'rockalitas-menu-alitas-20' THEN 20 WHEN 'rockalitas-menu-alitas-30' THEN 30
  WHEN 'rockalitas-menu-paquete-pueblo' THEN 10 WHEN 'rockalitas-menu-paquete-nirvana' THEN 20 WHEN 'rockalitas-menu-paquete-iron' THEN 30 WHEN 'rockalitas-menu-paquete-led' THEN 40 END,
  '$[0].unit','piezas'),updated_at=CAST(strftime('%s','now') AS INTEGER)*1000,
  seq=(SELECT seq+1 FROM tenants WHERE tenants.id=products.tenant_id)
WHERE id IN ('rockalitas-menu-alitas-10','rockalitas-menu-alitas-20','rockalitas-menu-alitas-30','rockalitas-menu-paquete-pueblo','rockalitas-menu-paquete-nirvana','rockalitas-menu-paquete-iron','rockalitas-menu-paquete-led')
 AND deleted=0 AND json_valid(modifiers) AND json_extract(modifiers,'$[0].name')='Salsa de la casa' AND json_extract(modifiers,'$[0].type') IS NULL;
UPDATE tenants SET seq=seq+1;
-- Una entrega independiente por chat; los errores quedan pendientes para reintento.
CREATE TABLE telegram_outbox (
 tenant_id TEXT NOT NULL, event_key TEXT NOT NULL, chat_id TEXT NOT NULL, text TEXT NOT NULL,
 created_at INTEGER NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,event_key,chat_id)
);
CREATE INDEX telegram_pending ON telegram_outbox(sent_at,next_attempt);
