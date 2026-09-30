// Inventario: existencias, entradas, mermas y conteo rápido.
import { S, on, get, list, sorted, stockOf, isLow, save, branchId, can } from '../store.js';
import { stockMove } from '../orders.js';
import { esc, money, qty, visual, toast, numpad, promptBox, timeHM } from '../ui.js';
import { uid, round3 } from '../shared/util.js';

const KIND = { sale: 'Venta', purchase: 'Entrada', waste: 'Merma', count: 'Conteo', adjust: 'Ajuste', return: 'Devolución' };

export function mount(el) {
  let tab = 'stock';
  let filter = 'all';
  let search = '';
  const counts = new Map();

  const tracked = () => sorted('products', (p) => p.track_stock && p.active !== 0);

  function draw() {
    const prods = tracked();
    const low = prods.filter((p) => isLow(p));
    const value = prods.reduce((s, p) => s + Math.max(0, stockOf(p.id)) * (Number(p.cost) || 0), 0);
    el.innerHTML = `<div class="inv">
      <div class="view-head"><h2>Inventario</h2>
        <div class="seg">${[['stock', 'Existencias'], ['count', 'Conteo rápido'], ['moves', 'Movimientos']].map(([k, v]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-t="${k}">${v}</button>`).join('')}</div></div>
      <div class="kpis">
        <div class="kpi"><small>Productos con inventario</small><b>${prods.length}</b></div>
        <div class="kpi ${low.length ? 'bad' : 'ok'}"><small>Bajo mínimo</small><b>${low.length}</b></div>
        ${can('reports') ? `<div class="kpi"><small>Valor a costo</small><b>${money(value)}</b></div>` : ''}
      </div>
      <div id="body"></div></div>`;
    drawBody();
  }

  function drawBody() {
    const body = el.querySelector('#body');
    const s = search.toLowerCase();
    const prods = tracked().filter((p) => (!s || p.name.toLowerCase().includes(s)) && (filter === 'all' || (filter === 'low' && isLow(p)) || (filter === 'insumos' && p.sellable === 0)));
    if (tab === 'stock') {
      body.innerHTML = `<div class="toolbar"><div class="search"><span>🔎</span><input id="q" type="search" value="${esc(search)}" placeholder="Buscar…"></div>
        <div class="cats">${[['all', 'Todos'], ['low', '⚠️ Bajo mínimo'], ['insumos', 'Insumos']].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${v}</button>`).join('')}</div></div>
        <div class="inv-list">${prods.map((p) => {
          const st = stockOf(p.id);
          return `<div class="inv-row ${isLow(p) ? 'low' : ''}">
            ${visual(p, 'sm')}
            <div class="ir-info"><b>${esc(p.name)}</b><small>Mínimo ${qty(p.stock_min || 0, p.unit)}${p.sellable === 0 ? ' · insumo' : ''}</small></div>
            <div class="ir-qty"><b>${qty(st, p.unit)}</b>${isLow(p) ? '<span class="tag red">Surtir</span>' : ''}</div>
            <div class="ir-actions">
              <button class="btn small green" data-act="in" data-id="${p.id}" title="Entrada de mercancía">＋ Entrada</button>
              <button class="btn small red" data-act="waste" data-id="${p.id}" title="Merma / pérdida">− Merma</button>
              <button class="btn small" data-act="adjust" data-id="${p.id}" title="Contar y ajustar">✎</button>
            </div></div>`;
        }).join('') || '<p class="empty">No hay productos con control de inventario. Actívalo en Ajustes → Productos.</p>'}</div>`;
      const q = body.querySelector('#q');
      q.oninput = () => { search = q.value; drawBody(); const n = el.querySelector('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    } else if (tab === 'count') {
      body.innerHTML = `<p class="muted">Cuenta físicamente y escribe lo que hay. Solo se ajustan los productos que cambies.</p>
        <div class="inv-list">${tracked().map((p) => `<div class="inv-row">
          ${visual(p, 'sm')}<div class="ir-info"><b>${esc(p.name)}</b><small>Sistema: ${qty(stockOf(p.id), p.unit)}</small></div>
          <input class="count-in" type="number" inputmode="decimal" step="any" min="0" data-id="${p.id}" value="${counts.has(p.id) ? counts.get(p.id) : ''}" placeholder="${qty(stockOf(p.id))}">
        </div>`).join('')}</div>
        <div class="sticky-actions"><button class="btn primary big" data-act="save-count">Guardar conteo</button></div>`;
    } else {
      const moves = list('stock_moves', (m) => m.branch_id === branchId()).sort((a, b) => b.created_at - a.created_at).slice(0, 200);
      body.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Hora</th><th>Producto</th><th>Tipo</th><th class="r">Cantidad</th><th>Usuario</th><th>Nota</th></tr></thead><tbody>
        ${moves.map((m) => {
          const p = get('products', m.product_id);
          const u = get('users', m.user_id);
          return `<tr><td>${new Date(m.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })} ${timeHM(m.created_at)}</td><td>${esc(p?.name || '—')}</td><td>${KIND[m.kind] || m.kind}</td><td class="r ${m.qty < 0 ? 'num-neg' : 'num-pos'}">${m.qty > 0 ? '+' : ''}${qty(m.qty, p?.unit)}</td><td>${esc(u?.name || '')}</td><td>${esc(m.note || '')}</td></tr>`;
        }).join('') || '<tr><td colspan="6" class="empty">Sin movimientos recientes en este dispositivo.</td></tr>'}</tbody></table></div>`;
    }
  }

  const onClick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    const p = a.dataset.id && get('products', a.dataset.id);
    if (act === 'tab') { tab = a.dataset.t; draw(); }
    else if (act === 'filter') { filter = a.dataset.f; drawBody(); }
    else if (act === 'in') {
      const n = await numpad(`Entrada · ${p.name}`, { unit: p.unit, hint: `Existencia actual: ${qty(stockOf(p.id), p.unit)}` });
      if (!n) return;
      const cost = can('reports') ? await numpad('Costo unitario (opcional)', { value: p.cost || '', hint: 'Deja igual si no cambió' }) : null;
      await stockMove({ product: p, qty: n, kind: 'purchase', cost: cost ?? p.cost });
      if (cost && cost !== p.cost) await save([['products', { ...p, cost }]]);
      toast(`+${qty(n, p.unit)} ${p.name}`);
    } else if (act === 'waste') {
      const n = await numpad(`Merma · ${p.name}`, { unit: p.unit, hint: 'Producto dañado, caducado o perdido' });
      if (!n) return;
      const note = await promptBox('Motivo (opcional)', { placeholder: 'Ej. caducó, se cayó' });
      await stockMove({ product: p, qty: -n, kind: 'waste', note: note || '' });
      toast(`−${qty(n, p.unit)} ${p.name}`, 'warn');
    } else if (act === 'adjust') {
      const cur = stockOf(p.id);
      const n = await numpad(`¿Cuánto hay de ${p.name}?`, { value: cur, unit: p.unit, hint: `El sistema dice ${qty(cur, p.unit)}` });
      if (n === null || n === cur) return;
      await stockMove({ product: p, qty: round3(n - cur), kind: 'count', note: `Conteo: ${n}` });
      toast('Inventario ajustado');
    } else if (act === 'save-count') {
      const rows = [];
      for (const [id, v] of counts) {
        const prod = get('products', id);
        const cur = stockOf(id);
        if (v === '' || !prod || Number(v) === cur) continue;
        rows.push(['stock_moves', { id: uid(), branch_id: branchId(), product_id: id, qty: round3(Number(v) - cur), kind: 'count', ref_id: null, note: `Conteo: ${v}`, user_id: S.user?.id, created_at: Date.now(), cost: prod.cost || 0 }]);
      }
      if (!rows.length) return toast('No hay cambios', 'info');
      await save(rows);
      counts.clear();
      toast(`Conteo guardado: ${rows.length} ajustes`);
      tab = 'stock';
      draw();
    }
  };
  const onInput = (e) => { if (e.target.classList.contains('count-in')) counts.set(e.target.dataset.id, e.target.value); };

  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  const off = on((c) => { if (tab !== 'count' && (c.has('stock_moves') || c.has('products'))) draw(); });
  draw();
  return () => { off(); el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); };
}
