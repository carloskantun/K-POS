// Pantalla de comandas (cocina / barra / taquero): qué preparar, cuántos en total y desde hace cuánto.
import { S, on, get, list, setMeta, save } from '../store.js';
import { orderTitle, modsText } from '../orders.js';
import { printKitchen } from '../printer.js';
import { esc, qty, beep, minutesAgo, visual } from '../ui.js';

const STATION_LABEL = { cocina: '🔥 Cocina', barra: '🍹 Barra' };

export function mount(el) {
  let station = S.meta.device?.station || 'all';
  const seen = new Set(list('order_items', (i) => i.status === 'sent').map((i) => i.id));
  let first = true;

  const stations = () => [...new Set(list('products', (p) => p.station).map((p) => p.station))];
  const match = (i) => i.station && (station === 'all' || i.station === station);

  function draw() {
    const since = Date.now() - 12 * 3600 * 1000;
    const pending = list('order_items', (i) => i.status === 'sent' && match(i) && (i.sent_at || 0) > since);
    const ready = list('order_items', (i) => i.status === 'ready' && match(i) && (i.ready_at || 0) > Date.now() - 2 * 3600 * 1000);

    const fresh = pending.filter((i) => !seen.has(i.id));
    if (fresh.length && !first) beep(2);
    fresh.forEach((i) => seen.add(i.id));
    first = false;

    // Totales por producto: "¿cuántos tacos al pastor tengo que hacer?"
    const totals = new Map();
    for (const i of pending) {
      const k = i.product_id || i.name;
      const t = totals.get(k) || { name: i.name, qty: 0, unit: i.unit, p: get('products', i.product_id) };
      t.qty += Number(i.qty);
      totals.set(k, t);
    }

    const groups = new Map();
    for (const i of pending) {
      if (!groups.has(i.order_id)) groups.set(i.order_id, []);
      groups.get(i.order_id).push(i);
    }
    const cards = [...groups.entries()].map(([oid, items]) => ({ o: get('orders', oid), items, t: Math.min(...items.map((i) => i.sent_at || 0)) }))
      .filter((g) => g.o).sort((a, b) => a.t - b.t);

    const readyGroups = new Map();
    for (const i of ready) {
      if (!readyGroups.has(i.order_id)) readyGroups.set(i.order_id, []);
      readyGroups.get(i.order_id).push(i);
    }

    const sts = stations();
    el.innerHTML = `<div class="kds">
      <div class="kds-head">
        <div class="cats">${sts.length > 1 ? ['all', ...sts].map((s) => `<button class="chip ${station === s ? 'on' : ''}" data-act="station" data-s="${s}">${s === 'all' ? 'Todas' : esc(STATION_LABEL[s] || s)}</button>`).join('') : ''}</div>
        <div class="kds-count"><b>${pending.reduce((s, i) => s + (i.unit === 'pza' ? Number(i.qty) : 1), 0)}</b> por preparar</div>
      </div>
      ${totals.size ? `<div class="kds-totals">${[...totals.values()].sort((a, b) => b.qty - a.qty).map((t) => `<span class="kt">${visual(t.p || {}, 'xs')}<b>${qty(t.qty)}</b> ${esc(t.name)}</span>`).join('')}</div>` : ''}
      <div class="kds-board">
        ${cards.map(({ o, items, t }) => {
          const min = minutesAgo(t);
          const u = get('users', o.user_id);
          return `<article class="kds-card ${min >= 20 ? 'late' : min >= 10 ? 'warn' : ''}">
            <header><b>${esc(orderTitle(o))}</b><span class="kds-time">${min} min</span></header>
            ${u ? `<small class="muted">${esc(u.name)}</small>` : ''}
            <ul>${items.map((i) => `<li data-act="ready" data-id="${i.id}"><span class="kq">${qty(i.qty, i.unit)}</span><span>${esc(i.name)}${i.mods?.length ? `<strong class="kmods">${esc(modsText(i.mods))}</strong>` : ''}${i.note ? `<em>${esc(i.note)}</em>` : ''}</span></li>`).join('')}</ul>
            <div class="kds-actions"><button class="btn pay" data-act="all-ready" data-id="${o.id}">✔ Todo listo</button><button class="btn" data-act="reprint" data-id="${o.id}" title="Imprimir comanda">🖨️</button></div>
          </article>`;
        }).join('') || '<div class="kds-empty">✨ Sin comandas pendientes</div>'}
      </div>
      ${readyGroups.size ? `<div class="kds-ready"><h3>Listos para entregar</h3><div class="kds-ready-list">${[...readyGroups.entries()].map(([oid, items]) => {
        const o = get('orders', oid);
        return o ? `<button class="ready-chip" data-act="served" data-id="${oid}"><b>${esc(orderTitle(o))}</b> ${items.map((i) => `${qty(i.qty)} ${esc(i.name)}`).join(', ')}</button>` : '';
      }).join('')}</div></div>` : ''}
    </div>`;
  }

  const onClick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const now = Date.now();
    if (a.dataset.act === 'station') {
      station = a.dataset.s;
      draw();
      await setMeta('device', { ...S.meta.device, station });
    } else if (a.dataset.act === 'ready') {
      const i = get('order_items', a.dataset.id);
      a.classList.add('done');
      await save([['order_items', { ...i, status: 'ready', ready_at: now }]]);
    } else if (a.dataset.act === 'all-ready') {
      const items = list('order_items', (i) => i.order_id === a.dataset.id && i.status === 'sent' && match(i));
      await save(items.map((i) => ['order_items', { ...i, status: 'ready', ready_at: now }]));
    } else if (a.dataset.act === 'reprint') {
      const items = list('order_items', (i) => i.order_id === a.dataset.id && i.status === 'sent' && match(i));
      printKitchen(get('orders', a.dataset.id), items, station === 'all' ? '' : station);
    } else if (a.dataset.act === 'served') {
      const items = list('order_items', (i) => i.order_id === a.dataset.id && i.status === 'ready' && match(i));
      await save(items.map((i) => ['order_items', { ...i, status: 'served' }]));
    }
  };

  el.addEventListener('click', onClick);
  const off = on((c) => { if (c.has('order_items') || c.has('orders')) draw(); });
  const timer = setInterval(draw, 20000);
  draw();
  return () => { off(); clearInterval(timer); el.removeEventListener('click', onClick); };
}
