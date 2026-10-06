// K-POS · Cloudflare Worker: API de sincronización multi-negocio + bot de Telegram + archivos de la PWA.
import { authDevice, hashPassword, verifyPassword, newToken, tokenHash, randomCode } from './auth.js';
import { push, pull } from './sync.js';
import { loadSummary, getConfig, buildReport } from './reports.js';
import { handleWebhook, scheduled, afterPush, chatsOf, sendToTenant, tgCall } from './telegram.js';
import { uid } from '../../public/js/shared/util.js';
import { TenantLive, notifyLive } from './live.js';
import { tooMany, clientIp } from './limits.js';
import { sendMail } from './mail.js';
import { exportSales } from './export.js';
import { adminApi } from './admin.js';

export { TenantLive };

const RESERVED = new Set(['www', 'api', 'app', 'admin', 'mail', 'static', 'cdn', 'demo']);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status, error) => json({ error }, status);

function slugFromHost(request, env) {
  const host = new URL(request.url).hostname.toLowerCase();
  const root = (env.ROOT_DOMAIN || '').toLowerCase();
  if (root && host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (!sub.includes('.') && !RESERVED.has(sub)) return sub;
  }
  return null;
}

const cleanSlug = (s) => String(s || '').trim().toLowerCase();
const validSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(s) && !RESERVED.has(s);

async function createDevice(env, tenantId, name) {
  const token = newToken();
  const id = uid();
  await env.DB.prepare('INSERT INTO devices (id, tenant_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, tenantId, String(name || 'Dispositivo').slice(0, 60), tokenHash(token), Date.now()).run();
  return { token, device_id: id };
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

async function api(request, env, ctx, path) {
  const method = request.method;
  const url = new URL(request.url);

  if (path === '/api/health') return json({ ok: true, time: Date.now() });

  if (path === '/api/whoami') {
    const slug = slugFromHost(request, env) || url.searchParams.get('t');
    if (!slug) return json({ slug: null, root_domain: env.ROOT_DOMAIN || null });
    const t = await env.DB.prepare('SELECT slug, name, business_type FROM tenants WHERE slug = ?').bind(cleanSlug(slug)).first();
    return json({ slug: t?.slug || cleanSlug(slug), name: t?.name || null, exists: !!t });
  }

  const ip = clientIp(request);
  const limitedPaths = { '/api/register': [5, 3600e3], '/api/login': [10, 900e3], '/api/link': [10, 900e3], '/api/password/forgot': [5, 3600e3], '/api/password/reset': [10, 900e3] };
  if (method === 'POST' && limitedPaths[path] && env.RATE_LIMIT !== 'off' && (await tooMany(env, `${path}:${ip}`, ...limitedPaths[path]))) {
    return fail(429, 'Demasiados intentos. Espera unos minutos y vuelve a intentar.');
  }

  if (path === '/api/password/forgot' && method === 'POST') {
    const b = await body(request);
    const t = await env.DB.prepare('SELECT id, name, owner_email FROM tenants WHERE slug = ?').bind(cleanSlug(b.slug)).first();
    if (t && t.owner_email === String(b.email || '').toLowerCase().trim()) {
      const code = randomCode(6);
      await env.DB.prepare('INSERT OR REPLACE INTO link_codes (code, tenant_id, purpose, expires_at) VALUES (?, ?, ?, ?)').bind(code, t.id, 'reset', Date.now() + 30 * 60 * 1000).run();
      ctx.waitUntil(sendMail(env, { to: t.owner_email, subject: `Código para ${t.name}`, html: `<p>Tu código para cambiar la contraseña de <b>${t.name}</b> es:</p><h2>${code}</h2><p>Vence en 30 minutos. Si no lo pediste, ignora este correo.</p>` }));
    }
    // Misma respuesta exista o no la cuenta (no revela qué correos están registrados).
    return json({ ok: true, email: !!env.RESEND_API_KEY });
  }

  if (path === '/api/password/reset' && method === 'POST') {
    const b = await body(request);
    if (String(b.password || '').length < 6) return fail(400, 'La contraseña debe tener al menos 6 caracteres.');
    const row = await env.DB.prepare("SELECT l.tenant_id FROM link_codes l JOIN tenants t ON t.id = l.tenant_id WHERE l.code = ? AND l.purpose = 'reset' AND l.expires_at > ? AND t.slug = ?")
      .bind(String(b.code || '').replace(/\D/g, ''), Date.now(), cleanSlug(b.slug)).first();
    if (!row) return fail(401, 'Código inválido o vencido.');
    await env.DB.batch([
      env.DB.prepare('UPDATE tenants SET owner_pass = ? WHERE id = ?').bind(await hashPassword(String(b.password)), row.tenant_id),
      env.DB.prepare("DELETE FROM link_codes WHERE tenant_id = ? AND purpose = 'reset'").bind(row.tenant_id),
    ]);
    return json({ ok: true });
  }

  if (path.startsWith('/api/admin/') && path !== '/api/admin/telegram-setup') return adminApi(request, env, path);

  if (path === '/api/register' && method === 'POST') {
    const b = await body(request);
    const slug = cleanSlug(b.slug);
    if (!validSlug(slug)) return fail(400, 'Nombre de cuenta inválido: usa 3 a 30 letras minúsculas, números o guiones.');
    if (!b.name || !b.email || !b.password || String(b.password).length < 6) return fail(400, 'Faltan datos: nombre, correo y contraseña (mínimo 6 caracteres).');
    const tenantId = /^[0-9a-f-]{36}$/.test(b.tenant_id || '') ? b.tenant_id : uid();
    const exists = await env.DB.prepare('SELECT 1 FROM tenants WHERE slug = ? OR id = ?').bind(slug, tenantId).first();
    if (exists) return fail(409, 'Ese nombre de cuenta ya está en uso.');
    await env.DB.prepare('INSERT INTO tenants (id, slug, name, business_type, owner_email, owner_pass, seq, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
      .bind(tenantId, slug, String(b.name).slice(0, 80), b.business_type || 'otro', String(b.email).toLowerCase().trim(), await hashPassword(String(b.password)), Date.now()).run();
    const dev = await createDevice(env, tenantId, b.device_name);
    return json({ ...dev, tenant: { id: tenantId, slug, name: b.name } });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await body(request);
    const t = await env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(cleanSlug(b.slug)).first();
    if (!t || String(b.email || '').toLowerCase().trim() !== t.owner_email || !(await verifyPassword(String(b.password || ''), t.owner_pass))) {
      return fail(401, 'Cuenta, correo o contraseña incorrectos.');
    }
    const dev = await createDevice(env, t.id, b.device_name);
    return json({ ...dev, tenant: { id: t.id, slug: t.slug, name: t.name } });
  }

  if (path === '/api/link' && method === 'POST') {
    const b = await body(request);
    const code = String(b.code || '').replace(/\D/g, '');
    const row = await env.DB.prepare(
      "SELECT l.tenant_id, t.slug, t.name FROM link_codes l JOIN tenants t ON t.id = l.tenant_id WHERE l.code = ? AND l.purpose = 'device' AND l.expires_at > ?",
    ).bind(code, Date.now()).first();
    if (!row || (b.slug && cleanSlug(b.slug) !== row.slug)) return fail(401, 'Código inválido o vencido.');
    const dev = await createDevice(env, row.tenant_id, b.device_name);
    return json({ ...dev, tenant: { id: row.tenant_id, slug: row.slug, name: row.name } });
  }

  if (path === '/api/telegram/webhook' && method === 'POST') return handleWebhook(request, env);

  if (path === '/api/admin/telegram-setup' && method === 'POST') {
    if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) return fail(403, 'forbidden');
    const hook = await tgCall(env, 'setWebhook', {
      url: `${url.origin}/api/telegram/webhook`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
      allowed_updates: ['message', 'channel_post'],
    });
    const cmds = await tgCall(env, 'setMyCommands', {
      commands: [
        { command: 'resumen', description: 'Resumen de ayer' },
        { command: 'hoy', description: 'Cómo va el día' },
        { command: 'stock', description: 'Productos con stock bajo' },
        { command: 'inventario', description: 'Existencias actuales' },
        { command: 'caja', description: 'Cajas abiertas' },
      ],
    });
    return json({ hook, cmds });
  }

  // ---------- Rutas con dispositivo autenticado ----------
  const dev = await authDevice(request, env);
  if (!dev) return fail(401, 'Dispositivo no autorizado. Vuelve a vincularlo.');
  // Cuenta suspendida (por ejemplo, por falta de pago): el dispositivo sigue vendiendo localmente,
  // pero no sincroniza hasta que se reactive desde /admin.
  if (dev.status === 'suspended') return fail(402, 'Cuenta suspendida. Contacta a tu proveedor de K-POS.');
  ctx.waitUntil(env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(Date.now(), dev.id).run());
  const tenantId = dev.tenant_id;

  if (path === '/api/live') {
    if (!env.LIVE) return fail(501, 'Tiempo real no disponible en este servidor');
    const u = new URL(request.url);
    u.searchParams.set('device', dev.id);
    return env.LIVE.get(env.LIVE.idFromName(tenantId)).fetch(new Request(u, request));
  }

  if (path === '/api/sync/push' && method === 'POST') {
    const b = await body(request);
    const res = await push(env, tenantId, b.changes);
    if (res.applied.length) {
      ctx.waitUntil(afterPush(env, tenantId, res.applied).catch((e) => console.error('afterPush', e)));
      ctx.waitUntil(notifyLive(env, tenantId, dev.id).catch((e) => console.error('live', e)));
    }
    return json({ ok: true, accepted: res.accepted, current: res.current });
  }

  if (path === '/api/sync/pull' && method === 'GET') {
    const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
    return json({ ...(await pull(env, tenantId, since)), live: !!env.LIVE, status: dev.status || 'active' });
  }

  if (path === '/api/link-code' && method === 'POST') {
    const b = await body(request);
    const purpose = b.purpose === 'telegram' ? 'telegram' : 'device';
    const code = randomCode(6);
    const expires = Date.now() + 15 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM link_codes WHERE expires_at < ?').bind(Date.now()),
      env.DB.prepare('INSERT OR REPLACE INTO link_codes (code, tenant_id, purpose, expires_at) VALUES (?, ?, ?, ?)').bind(code, tenantId, purpose, expires),
    ]);
    return json({ code, expires_at: expires, bot: env.TELEGRAM_BOT_USERNAME || null });
  }

  if (path === '/api/reports/summary' && method === 'GET') {
    const cfg = await getConfig(env, tenantId);
    const date = url.searchParams.get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail(400, 'Fecha inválida');
    return json(await loadSummary(env, tenantId, { date, tz: cfg.timezone, branchId: url.searchParams.get('branch') || null }));
  }

  if (path === '/api/password/change' && method === 'POST') {
    const b = await body(request);
    const t = await env.DB.prepare('SELECT owner_pass FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!(await verifyPassword(String(b.current || ''), t.owner_pass))) return fail(401, 'La contraseña actual no es correcta.');
    if (String(b.password || '').length < 6) return fail(400, 'La nueva contraseña debe tener al menos 6 caracteres.');
    await env.DB.prepare('UPDATE tenants SET owner_pass = ? WHERE id = ?').bind(await hashPassword(String(b.password)), tenantId).run();
    return json({ ok: true });
  }

  if (path === '/api/export/sales' && method === 'GET') {
    const cfg = await getConfig(env, tenantId);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to') || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return fail(400, 'Fechas inválidas');
    const csv = await exportSales(env, tenantId, { from, to, tz: cfg.timezone });
    if (csv == null) return fail(400, 'El rango máximo es de 92 días.');
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ventas-${from}_${to}.csv"`, 'cache-control': 'no-store' } });
  }

  if (path === '/api/devices' && method === 'GET') {
    const r = await env.DB.prepare('SELECT id, name, created_at, last_seen, revoked FROM devices WHERE tenant_id = ? ORDER BY created_at').bind(tenantId).all();
    return json({ devices: r.results || [], current: dev.id });
  }

  if (path === '/api/devices/revoke' && method === 'POST') {
    const b = await body(request);
    await env.DB.prepare('UPDATE devices SET revoked = 1 WHERE id = ? AND tenant_id = ?').bind(String(b.id || ''), tenantId).run();
    return json({ ok: true });
  }

  if (path === '/api/telegram/chats' && method === 'GET') {
    return json({ chats: await chatsOf(env, tenantId), bot: env.TELEGRAM_BOT_USERNAME || null, configured: !!env.TELEGRAM_BOT_TOKEN });
  }

  if (path === '/api/telegram/chats' && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM telegram_chats WHERE tenant_id = ? AND chat_id = ?').bind(tenantId, url.searchParams.get('chat_id') || '').run();
    return json({ ok: true });
  }

  if (path === '/api/telegram/test' && method === 'POST') {
    const b = await body(request);
    const tenant = { id: tenantId, name: dev.tenant_name, slug: dev.slug };
    const { text } = await buildReport(env, tenant, b.kind === 'yesterday' ? 'yesterday' : 'today');
    const sent = await sendToTenant(env, tenantId, text);
    return json({ ok: true, sent });
  }

  return fail(404, 'Ruta no encontrada');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, ctx, url.pathname.replace(/\/+$/, ''));
      } catch (e) {
        console.error(e);
        return fail(500, 'Error interno');
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('K-POS', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduled(env));
  },
};
