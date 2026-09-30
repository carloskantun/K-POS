// API de administración (tú, como proveedor): clientes, estado de pago, soporte.
// Protegida con el encabezado x-admin-key = ADMIN_KEY.
import { hashPassword, randomCode } from './auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function adminApi(request, env, path) {
  if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const b = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const week = Date.now() - 7 * 86400000;

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
