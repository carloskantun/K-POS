#!/usr/bin/env node
// Servidor local K-POS: corre el mismo Worker en una PC / mini PC / Raspberry del negocio.
// Sirve para (1) desarrollo local y (2) operar en red interna (Wi-Fi del local) sin internet.
//
//   node hub/server.js                 → http://localhost:8787
//   PORT=8080 DB_FILE=./kpos.db node hub/server.js
//
// Variables opcionales: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ADMIN_KEY, ROOT_DOMAIN.
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1 } from './d1.js';
import worker from '../worker/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export async function migrate(DB) {
  const dir = path.join(root, 'worker', 'migrations');
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
    await DB.exec(await readFile(path.join(dir, f), 'utf8'));
  }
}

async function serveStatic(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(publicDir, path.normalize(rel));
  if (!file.startsWith(publicDir)) return new Response('forbidden', { status: 403 });
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
  } catch {
    file = path.join(publicDir, 'index.html'); // SPA
  }
  const data = await readFile(file);
  return new Response(data, {
    headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' },
  });
}

export async function createEnv(dbFile = ':memory:', extra = {}) {
  const DB = createD1(dbFile);
  await migrate(DB);
  return { DB, ASSETS: { fetch: serveStatic }, ROOT_DOMAIN: process.env.ROOT_DOMAIN || '', ...pickEnv(), ...extra };
}

function pickEnv() {
  const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_BOT_USERNAME', 'ADMIN_KEY'];
  return Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
}

export function startServer(env, port) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const waits = [];
      const response = await worker.fetch(request, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      await Promise.allSettled(waits);
    } catch (e) {
      console.error(e);
      res.writeHead(500).end('error');
    }
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const env = await createEnv(process.env.DB_FILE || path.join(root, 'kpos-local.db'));
  await startServer(env, port);
  // Cron local: cada hora revisa resúmenes de Telegram (si hay internet y token).
  setInterval(() => worker.scheduled({}, env, { waitUntil: (p) => p.catch(console.error) }), 60 * 60 * 1000);
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`K-POS local listo:\n  http://localhost:${port}`);
  for (const ip of ips) console.log(`  http://${ip}:${port}   (otros dispositivos en la misma red)`);
}
