// Durable Object por negocio: mantiene los WebSocket de sus dispositivos y les avisa
// "hay cambios" en cuanto otro dispositivo sube algo. El dispositivo entonces hace pull.
// Usa la API de hibernación: sin mensajes, el objeto no consume tiempo de CPU.
export class TenantLive {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/notify') {
      const msg = await request.text();
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(msg); } catch { /* conexión cerrada */ }
      }
      return new Response('ok');
    }
    if (request.headers.get('upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [url.searchParams.get('device') || '']);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (message === 'ping') ws.send('pong');
  }

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* ya cerrado */ }
  }
}

export async function notifyLive(env, tenantId, deviceId) {
  if (!env.LIVE) return;
  const stub = env.LIVE.get(env.LIVE.idFromName(tenantId));
  await stub.fetch('https://live/notify', { method: 'POST', body: JSON.stringify({ type: 'changed', by: deviceId }) });
}
