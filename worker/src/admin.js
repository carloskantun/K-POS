// API de administración (tú, como proveedor): clientes, estado de pago, soporte.
// Protegida con el encabezado x-admin-key = ADMIN_KEY.
import { hashPassword, randomCode } from './auth.js';
import { buildSeed, PRESETS } from '../../public/js/shared/presets.js';
import { TABLES } from '../../public/js/shared/schema.js';
import { uid } from '../../public/js/shared/util.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function adminApi(request, env, path) {
  if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const b = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const week = Date.now() - 7 * 86400000;

  if (path !== '/api/admin/tenants' && request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (path === '/api/admin/tenants/create') {
    const name = String(b.name || '').trim();
    const owner = String(b.owner || '').trim();
    const slug = String(b.slug || '').trim().toLowerCase();
    const email = String(b.email || '').trim().toLowerCase();
    const type = String(b.business_type || 'otro');
    const catalog = b.catalog || 'empty';
    const timezone = b.timezone || 'America/Cancun';
    if (!name || name.length > 80 || !owner || owner.length > 80) return json({ error: 'Nombre del negocio y del dueño: entre 1 y 80 caracteres.' }, 400);
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug) || ['www','api','app','admin','mail','static','cdn','demo'].includes(slug)) return json({ error: 'Cuenta inválida: usa de 3 a 30 letras minúsculas, números o guiones.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Escribe un correo válido del dueño.' }, 400);
    if (typeof b.password !== 'string' || b.password.length < 6 || b.password.length > 256 || !/^\d{4}$/.test(String(b.pin || ''))) return json({ error: 'Contraseña de 6 a 256 caracteres y PIN de 4 dígitos.' }, 400);
    if (!Object.hasOwn(PRESETS, type) || !['empty','sample','rockalitas'].includes(catalog)) return json({ error: 'Giro o catálogo inválido.' }, 400);
    if (catalog === 'rockalitas' && !['bar','restaurante','rockalitas'].includes(type)) return json({ error: 'El menú Rock Alitas corresponde a bar o restaurante.' }, 400);
    try { new Intl.DateTimeFormat('es-MX', { timeZone: timezone }); } catch { return json({ error: 'Zona horaria inválida.' }, 400); }
    const paidUntil = b.paid_until == null ? null : Number(b.paid_until);
    if (paidUntil !== null && (!Number.isFinite(paidUntil) || paidUntil < 0)) return json({ error: 'Fecha de pago inválida.' }, 400);
    if (!['trial','active'].includes(b.status || 'trial')) return json({ error: 'Estado inicial inválido.' }, 400);
    if (await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first()) return json({ error: 'Ese nombre de cuenta ya existe.' }, 409);
    const id = uid();
    const seed = buildSeed({ type: catalog === 'rockalitas' ? 'rockalitas' : type, tenantId: id, businessName: name, ownerName: owner, pin: b.pin, timezone });
    seed.rows.config[0].value.type = type;
    seed.rows.config[0].value.menu_template = catalog;
    delete seed.rows.stock_moves; // El alta no inventa existencias del negocio.
    if (catalog === 'empty') { delete seed.rows.products; delete seed.rows.categories; }
    const changes = Object.entries(seed.rows).flatMap(([t,rs]) => rs.map(r => ({t,r})));
    const statements = [env.DB.prepare('INSERT INTO tenants (id, slug, name, business_type, owner_email, owner_pass, seq, created_at, status, plan, paid_until, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, slug, name, type, email, await hashPassword(b.password), changes.length, Date.now(), b.status || 'trial', String(b.plan || '').slice(0,120), paidUntil, String(b.notes || '').slice(0,1000))];
    // Una sentencia por tabla mantiene el alta dentro de los límites del plan gratuito.
    // json_each recibe datos ligados, nunca SQL del usuario. Todo el lote es atómico.
    let seq = 0;
    for (const [table, rows] of Object.entries(seed.rows)) {
      if (!rows.length) continue;
      const cols = ['id','updated_at','deleted','seq',...TABLES[table]];
      const data = rows.map(row => ({...row, seq:++seq}));
      const select = cols.map(col => `json_extract(value, '$.${col}')`).join(',');
      statements.push(env.DB.prepare(`INSERT INTO "${table}" (tenant_id, ${cols.map(col => `"${col}"`).join(',')}) SELECT ?, ${select} FROM json_each(?)`)
        .bind(id, JSON.stringify(data)));
    }
    try { await env.DB.batch(statements); }
    catch {
      if (await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first()) return json({ error: 'Ese nombre de cuenta ya existe.' }, 409);
      return json({ error: 'No se pudo guardar el cliente. Intenta de nuevo.' }, 500);
    }
    return json({ tenant: { id, slug, name, business_type:type }, products:seed.rows.products?.length || 0 }, 201);
  }

  if (path === '/api/admin/tenants') {
    const r = await env.DB.prepare(
      `SELECT t.id, t.slug, t.name, t.business_type, t.owner_email, t.status, t.plan, t.paid_until, t.notes, t.created_at,
        (SELECT COUNT(*) FROM devices d WHERE d.tenant_id = t.id AND d.revoked = 0) AS devices,
        (SELECT MAX(last_seen) FROM devices d WHERE d.tenant_id = t.id) AS last_seen,
        (SELECT COUNT(*) FROM telegram_chats c WHERE c.tenant_id = t.id) AS chats,
        (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.tenant_id = t.id AND o.status = 'paid' AND o.closed_at > ?) AS sales_7d,
        (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = t.id AND o.status = 'paid' AND o.closed_at > ?) AS tickets_7d
       FROM tenants t ORDER BY t.created_at DESC`,
    ).bind(week, week).all();
    return json({ tenants: r.results || [] });
  }

  if (path === '/api/admin/tenants/update') {
    const status = ['active', 'suspended', 'trial'].includes(b.status) ? b.status : 'active';
    await env.DB.prepare('UPDATE tenants SET status = ?, plan = ?, paid_until = ?, notes = ? WHERE id = ?')
      .bind(status, b.plan || null, b.paid_until ? Number(b.paid_until) : null, b.notes || null, b.id).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/tenants/reset-password') {
    if (String(b.password || '').length < 6) return json({ error: 'Mínimo 6 caracteres' }, 400);
    await env.DB.prepare('UPDATE tenants SET owner_pass = ? WHERE id = ?').bind(await hashPassword(String(b.password)), b.id).run();
    return json({ ok: true });
  }

  if (path === '/api/admin/tenants/link-code') {
    const code = randomCode(6);
    await env.DB.prepare("INSERT OR REPLACE INTO link_codes (code, tenant_id, purpose, expires_at) VALUES (?, ?, 'device', ?)").bind(code, b.id, Date.now() + 15 * 60 * 1000).run();
    return json({ code });
  }

  return json({ error: 'not found' }, 404);
}
