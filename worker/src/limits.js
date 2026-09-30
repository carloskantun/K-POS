// Límite de intentos (login, vinculación, registro, recuperación) para frenar fuerza bruta.
export async function tooMany(env, key, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, window_start FROM attempts WHERE key = ?').bind(key).first();
  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare('INSERT OR REPLACE INTO attempts (key, count, window_start) VALUES (?, 1, ?)').bind(key, now).run();
    return false;
  }
  if (row.count >= max) return true;
  await env.DB.prepare('UPDATE attempts SET count = count + 1 WHERE key = ?').bind(key).run();
  return false;
}

export const clientIp = (request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
