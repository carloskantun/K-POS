import { sha256hex } from '../../public/js/shared/util.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

// Workers limita PBKDF2 a 100k iteraciones.
const ITER = 100000;

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return `pbkdf2$${ITER}$${hex(salt)}$${hex(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [, , salt, want] = String(stored).split('$');
  if (!salt || !want) return false;
  const got = (await hashPassword(password, salt)).split('$')[3];
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 && got.length === want.length;
}

export function newToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export const tokenHash = (token) => sha256hex(`device:${token}`);

export function randomCode(len = 6) {
  const digits = crypto.getRandomValues(new Uint8Array(len));
  return [...digits].map((d) => d % 10).join('');
}

// Devuelve el dispositivo autenticado o null.
export async function authDevice(request, env) {
  const h = request.headers.get('authorization') || '';
  // Los WebSocket del navegador no pueden mandar encabezados: en /api/live el token va en la URL.
  const url = new URL(request.url);
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : url.pathname === '/api/live' ? url.searchParams.get('token') || '' : '';
  if (!token) return null;
  const dev = await env.DB.prepare(
    'SELECT d.id, d.tenant_id, d.name, t.slug, t.name AS tenant_name, t.status FROM devices d JOIN tenants t ON t.id = d.tenant_id WHERE d.token_hash = ? AND d.revoked = 0',
  ).bind(tokenHash(token)).first();
  return dev || null;
}
