// Mapa de mesas: libre / ocupada / con platillos listos para llevar.
import { S, on, get, sorted, branchId } from '../store.js';
import { openOrders, liveItems, orderTitle } from '../orders.js';
import { esc, money, minutesAgo } from '../ui.js';

export function mount(el, params, { go }) {
  function draw() {
    const orders = openOrders();
    const byTable = new Map(orders.filter((o) => o.table_id).map((o) => [o.table_id, o]));
    const tables = sorted('tables', (t) => t.active !== 0 && t.branch_id === branchId());
    const zones = [...new Set(tables.map((t) => t.zone || ''))];
    const mineOnly = S.user?.role === 'mesero';
    const loose = orders.filter((o) => !o.table_id && o.kind !== 'mostrador');

    const card = (t) => {
      const o = byTable.get(t.id);
      if (!o) return `<button class="table-card free" data-act="table" data-id="${t.id}"><b>${esc(t.name)}</b><small>Libre</small></button>`;
      const items = liveItems(o.id);
      const ready = items.filter((i) => i.status === 'ready').length;
      const cooking = items.filter((i) => i.status === 'sent').length;
      const u = get('users', o.user_id);
      const mine = o.user_id === S.user?.id;
      return `<button class="table-card busy ${ready ? 'ready' : ''} ${mineOnly && !mine ? 'other' : ''}" data-act="table" data-id="${t.id}">
        <b>${esc(t.name)}</b><span class="tc-total">${money(o.total)}</span>
        <small>${u ? esc(u.name) : ''} · ${minutesAgo(o.opened_at)} min</small>
        ${ready ? `<span class="tag green">🔔 ${ready} listo</span>` : cooking ? `<span class="tag amber">🔥 ${cooking}</span>` : ''}
      </button>`;
    };

    el.innerHTML = `<div class="tables-view">
      <div class="view-head"><h2>Mesas</h2><div class="legend"><span class="dot free"></span>Libre <span class="dot busy"></span>Ocupada <span class="dot ready"></span>Listo para llevar</div></div>
      ${zones.map((z) => `${z ? `<h3>${esc(z)}</h3>` : ''}<div class="table-grid">${tables.filter((t) => (t.zone || '') === z).map(card).join('')}</div>`).join('')}
      ${tables.length ? '' : '<p class="empty">No hay mesas. Créalas en Ajustes → Mesas.</p>'}
      <h3>Cuentas sin mesa ${loose.length ? `(${loose.length})` : ''}</h3>
      <div class="table-grid">
        ${loose.map((o) => `<button class="table-card busy" data-act="order" data-id="${o.id}"><b>${esc(orderTitle(o))}</b><span class="tc-total">${money(o.total)}</span><small>${minutesAgo(o.opened_at)} min</small></button>`).join('')}
        <button class="table-card add" data-act="new">＋ Para llevar / barra</button>
      </div>
    </div>`;
  }

  const onClick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'table') go('pos', { table: a.dataset.id });
    if (a.dataset.act === 'order') go('pos', { order: a.dataset.id });
    if (a.dataset.act === 'new') go('pos');
  };
  el.addEventListener('click', onClick);
  const off = on(draw);
  const timer = setInterval(draw, 30000);
  draw();
  return () => { off(); clearInterval(timer); el.removeEventListener('click', onClick); };
}
