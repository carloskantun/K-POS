// Punto de venta: foto → toque = agregar. Sirve para caja (mostrador), mesero (mesa/cuenta) y granel.
import { S, on, get, list, sorted, mod, can, cfg, setMeta, available, openCashSession, save } from '../store.js';
import {
  createOrder, addItem, setItemQty, setItemNote, sendOrder, payOrder, cancelItem, cancelOrder, discardIfEmpty,
  liveItems, allItems, newItems, openOrders, orderForTable, orderTitle, setItemStatus,
} from '../orders.js';
import { esc, money, qty, visual, toast, openModal, confirmBox, promptBox, numpad, timeHM, minutesAgo } from '../ui.js';
import { PAY_METHODS } from '../shared/schema.js';
import { round2, round3 } from '../shared/util.js';

const STATUS_TAG = {
  sent: ['En preparación', 'amber'], ready: ['¡Listo!', 'green'], served: ['Entregado', 'gray'], cancelled: ['Cancelado', 'red'],
};

export function mount(el, params, { go }) {
  let cat = 'all';
  let search = '';
  let order = null;
  let tableId = params.table || null;

  if (params.order) order = get('orders', params.order);
  else if (tableId) order = orderForTable(tableId);
  else if (S.meta.current_order) order = get('orders', S.meta.current_order);
  if (order && (order.status !== 'open' || order.deleted)) order = null;
  if (order?.table_id) tableId = order.table_id;
  if (!tableId && order) setMeta('current_order', order.id);

  el.innerHTML = `<div class="pos">
    <section class="catalog">
      <div class="pos-toolbar">
        <div class="search"><span>🔎</span><input id="q" type="search" autocomplete="off" placeholder="${mod('barcode') ? 'Buscar o escanear código…' : 'Buscar producto…'}"></div>
        <button class="btn" data-act="accounts">🧾 Cuentas <b id="acc-n"></b></button>
      </div>
      <div class="cats" id="cats"></div>
      <div class="grid" id="grid"></div>
    </section>
    <aside class="ticket" id="ticket"></aside>
    <button class="cart-bar" id="cartbar" data-act="open-cart"></button>
  </div>`;

  const $ = (s) => el.querySelector(s);
  const q = $('#q');

  const products = () => sorted('products', (p) => p.active !== 0 && p.sellable !== 0);
  const cartQty = () => {
    const m = new Map();
    if (order) for (const i of liveItems(order.id)) if (i.status === 'new') m.set(i.product_id, (m.get(i.product_id) || 0) + Number(i.qty));
    return m;
  };

  function drawCats() {
    const cats = sorted('categories', (c) => c.active !== 0 && products().some((p) => p.category_id === c.id));
    $('#cats').innerHTML = [`<button class="chip ${cat === 'all' ? 'on' : ''}" data-act="cat" data-id="all">Todo</button>`,
      ...cats.map((c) => `<button class="chip ${cat === c.id ? 'on' : ''}" data-act="cat" data-id="${c.id}" style="--c:${esc(c.color || '#64748b')}">${esc(c.emoji || '')} ${esc(c.name)}</button>`)].join('');
  }

  function drawGrid() {
    const s = search.toLowerCase();
    const inCart = cartQty();
    const items = products().filter((p) => (cat === 'all' || p.category_id === cat) && (!s || p.name.toLowerCase().includes(s) || (p.barcode && p.barcode.includes(s))));
    $('#grid').innerHTML = items.map((p) => {
      const av = available(p);
      const n = inCart.get(p.id) || 0;
      const out = av !== null && av <= 0;
      const low = av !== null && !out && (p.track_stock ? av <= (Number(p.stock_min) || 0) : av <= 5);
      const unitLbl = p.unit && p.unit !== 'pza' ? `/${p.unit}` : '';
      return `<button class="card ${n ? 'in-cart' : ''} ${out ? 'out' : ''}" data-act="add" data-id="${p.id}">
        <span class="pic-wrap">${visual(p)}${av !== null ? `<span class="stock ${out ? 'out' : low ? 'low' : ''}" title="Disponibles">${out ? 'Agotado' : qty(av, p.unit)}</span>` : ''}</span>
        <span class="name">${esc(p.name)}</span>
        <span class="price">${money(p.price)}${unitLbl}</span>
        ${n ? `<span class="count">${qty(n)}</span><span class="minus" data-act="minus" data-id="${p.id}" role="button" aria-label="Quitar uno">−</span>` : ''}
      </button>`;
    }).join('') || '<p class="empty">No hay productos. Agrégalos en Ajustes → Productos.</p>';
  }

  function drawTicket() {
    const t = tableId && get('tables', tableId);
    const items = order ? allItems(order.id) : [];
    const pendingNew = order ? newItems(order) : [];
    const total = order ? Number(order.total) : 0;
    const title = order ? orderTitle(order) : t ? t.name : 'Nueva venta';
    const waiter = order && get('users', order.user_id);
    const kitchenNew = pendingNew.filter((i) => i.station && mod('kitchen')).length;
    const showSend = order && pendingNew.length && (mod('kitchen') || mod('tables') || order.kind !== 'mostrador');

    $('#ticket').innerHTML = `
      <header class="t-head">
        <button class="icon-btn only-mobile" data-act="close-cart" aria-label="Cerrar">⌄</button>
        <div class="t-title"><b>${esc(title)}</b>${order ? `<small>#${order.number} · ${timeHM(order.opened_at)}${waiter ? ` · ${esc(waiter.name)}` : ''}</small>` : '<small>Toca un producto para agregarlo</small>'}</div>
        ${order ? `<button class="icon-btn" data-act="order-menu" aria-label="Opciones">⋯</button>` : ''}
      </header>
      <div class="t-lines">${items.length ? items.map(line).join('') : '<div class="empty big-empty">🛒<p>Sin productos</p></div>'}</div>
      <footer class="t-foot">
        ${order?.discount ? `<div class="t-row"><span>Descuento</span><span>−${money(order.discount)}</span></div>` : ''}
        <div class="t-total"><span>Total</span><b>${money(total)}</b></div>
        <div class="t-actions">
          ${showSend ? `<button class="btn send big" data-act="send">${kitchenNew ? `👨‍🍳 Enviar comanda (${kitchenNew})` : '💾 Guardar cuenta'}</button>` : ''}
          ${can('charge') ? `<button class="btn pay big" data-act="pay" ${!order || !liveItems(order.id).length ? 'disabled' : ''}>💵 Cobrar ${money(total)}</button>` : ''}
        </div>
      </footer>`;

    const n = order ? liveItems(order.id).reduce((s, i) => s + (i.unit === 'pza' ? Number(i.qty) : 1), 0) : 0;
    $('#cartbar').innerHTML = `<span class="cb-n">${n}</span><span>${esc(title)}</span><b>${money(total)}</b><span>Ver pedido ▸</span>`;
    $('#cartbar').hidden = !order;
    const acc = openOrders().filter((o) => o.kind !== 'mostrador').length;
    $('#acc-n').textContent = acc ? `(${acc})` : '';
  }

  function line(i) {
    const p = get('products', i.product_id);
    const isNew = i.status === 'new';
    const [tag, color] = STATUS_TAG[i.status] || [];
    return `<div class="line ${isNew ? '' : 'locked'} ${i.status}" data-id="${i.id}">
      ${visual(p || { emoji: '🏷️' }, 'sm')}
      <div class="l-info" data-act="${isNew ? 'note' : 'item-menu'}" data-id="${i.id}">
        <b>${esc(i.name)}</b>
        <small>${qty(i.qty, i.unit)} × ${money(i.price)}${i.note ? ` · <i>${esc(i.note)}</i>` : ''}</small>
        ${tag ? `<span class="tag ${color}">${tag}</span>` : ''}
      </div>
      ${isNew ? `<div class="stepper">
          <button class="step red" data-act="dec" data-id="${i.id}" aria-label="Quitar">−</button>
          <span data-act="setqty" data-id="${i.id}">${qty(i.qty)}</span>
          <button class="step green" data-act="inc" data-id="${i.id}" aria-label="Agregar">+</button>
        </div>` : `<span class="l-total ${i.status === 'cancelled' ? 'strike' : ''}">${money(i.total)}</span>`}
    </div>`;
  }

  const drawAll = () => { drawCats(); drawGrid(); drawTicket(); };

  async function ensureOrder() {
    if (order && order.status === 'open' && !order.deleted) return order;
    order = await createOrder({ table_id: tableId, kind: tableId ? 'mesa' : 'mostrador' });
    if (!tableId) await setMeta('current_order', order.id);
    return order;
  }

  const refreshOrder = () => { if (order) order = get('orders', order.id) || order; };

  async function add(p) {
    let amount = 1;
    if (mod('weight') && p.unit && p.unit !== 'pza') {
      amount = await weightPad(p);
      if (!amount) return;
    }
    const av = available(p);
    const already = cartQty().get(p.id) || 0;
    if (av !== null && av - already < amount) {
      if (cfg().allow_negative_stock === false) return toast(`Sin existencias de ${p.name}`, 'error');
      toast(av - already <= 0 ? `⚠️ ${p.name}: agotado en inventario` : `⚠️ Solo quedan ${qty(av - already, p.unit)} de ${p.name}`, 'warn');
    }
    await ensureOrder();
    await addItem(order, p, amount);
    refreshOrder();
    const card = el.querySelector(`.card[data-id="${p.id}"]`);
    card?.classList.remove('flash');
    void card?.offsetWidth;
    card?.classList.add('flash');
  }

  function weightPad(p) {
    return new Promise((resolve) => {
      let byMoney = false;
      let v = '';
      const price = Number(p.price) || 0;
      const calc = () => {
        const n = parseFloat(v) || 0;
        return byMoney ? (price ? round3(n / price) : 0) : n;
      };
      const m = openModal({
        title: `${p.emoji || ''} ${p.name}`,
        size: 'small',
        html: `<div class="numpad">
          <div class="seg"><button class="on" data-act="mode" data-m="kg">Por ${esc(p.unit)}</button><button data-act="mode" data-m="money">Por importe $</button></div>
          <div class="np-display"><span class="np-val">0</span> <small class="np-unit">${esc(p.unit)}</small></div>
          <p class="muted center np-calc">${money(price)} / ${esc(p.unit)}</p>
          <div class="np-quick">${[0.25, 0.5, 0.75, 1, 2].map((x) => `<button class="btn" data-act="q" data-v="${x}">${x === 0.25 ? '¼' : x === 0.5 ? '½' : x === 0.75 ? '¾' : x} ${esc(p.unit)}</button>`).join('')}</div>
          <div class="np-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button class="np-key" data-act="k" data-k="${k}">${k}</button>`).join('')}</div>
          <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn pay big" data-act="ok">Agregar</button></div></div>`,
        onClick: (act, a) => {
          if (act === 'mode') {
            byMoney = a.dataset.m === 'money';
            v = '';
            m.el.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b === a));
            m.$('.np-quick').hidden = byMoney;
          } else if (act === 'q') { byMoney = false; v = a.dataset.v; }
          else if (act === 'k') {
            const k = a.dataset.k;
            if (k === '⌫') v = v.slice(0, -1);
            else if (!(k === '.' && v.includes('.')) && v.length < 8) v += k;
          } else if (act === 'ok') {
            const n = calc();
            return m.close(n > 0 ? n : null);
          }
          m.$('.np-val').textContent = byMoney ? `$${v || '0'}` : v || '0';
          m.$('.np-unit').textContent = byMoney ? '' : p.unit;
          const n = calc();
          m.$('.np-calc').textContent = byMoney ? `= ${qty(n, p.unit)}` : `= ${money(n * price)}`;
        },
        onClose: (r) => resolve(r ?? null),
      });
    });
  }

  function accountsModal() {
    const list2 = openOrders().filter((o) => o.kind !== 'mostrador');
    const m = openModal({
      title: 'Cuentas abiertas',
      html: `<div class="acc-list">${list2.map((o) => {
        const u = get('users', o.user_id);
        const ready = liveItems(o.id).filter((i) => i.status === 'ready').length;
        return `<button class="acc" data-act="open" data-id="${o.id}">
          <b>${esc(orderTitle(o))}</b><span>${money(o.total)}</span>
          <small>${u ? esc(u.name) + ' · ' : ''}${minutesAgo(o.opened_at)} min${ready ? ` · <span class="tag green">${ready} listo</span>` : ''}</small></button>`;
      }).join('') || '<p class="empty">No hay cuentas abiertas.</p>'}</div>
        <div class="actions"><button class="btn primary big" data-act="new">＋ Nueva cuenta</button></div>`,
      onClick: async (act, a) => {
        if (act === 'open') {
          m.close();
          await leaveCurrent();
          const o = get('orders', a.dataset.id);
          if (o.table_id) go('pos', { table: o.table_id });
          else { await setMeta('current_order', o.id); order = o; tableId = null; drawAll(); }
        } else if (act === 'new') {
          const name = await promptBox('Nueva cuenta', { label: 'Nombre o referencia (opcional)', placeholder: 'Ej. Juan, Mesa de afuera, Para llevar', ok: 'Crear' });
          if (name === null) return;
          m.close();
          await leaveCurrent();
          order = await createOrder({ customer: name, kind: 'cuenta' });
          tableId = null;
          await setMeta('current_order', order.id);
          drawAll();
        }
      },
    });
  }

  // Si la venta de mostrador actual quedó vacía se descarta; si tiene productos, queda como cuenta.
  async function leaveCurrent() {
    if (!order) return;
    if (!(await discardIfEmpty(order)) && order.kind === 'mostrador') {
      await save([['orders', { ...order, kind: 'cuenta' }]]);
    }
    order = null;
    await setMeta('current_order', null);
  }

  async function doSend() {
    let customer;
    const kitchenNew = newItems(order).filter((i) => i.station && mod('kitchen')).length;
    if (!order.table_id && !order.customer && order.kind === 'mostrador') {
      customer = await promptBox('¿A nombre de quién?', { placeholder: 'Ej. Juan, Para llevar, Mesa 3', label: 'Para identificar la cuenta (opcional)', ok: 'Enviar' });
      if (customer === null) return;
    }
    await sendOrder(order, { customer });
    toast(kitchenNew ? `Comanda enviada (${kitchenNew})` : 'Cuenta guardada');
    el.querySelector('.ticket')?.classList.remove('open');
    if (tableId && mod('tables')) return go('tables');
    order = null;
    await setMeta('current_order', null);
    drawAll();
  }

  function payModal() {
    const o = order;
    let method = 'efectivo';
    let received = '';
    const total = () => Number(get('orders', o.id)?.total || 0);
    const session = openCashSession();

    const quick = () => {
      const t = total();
      const bills = [20, 50, 100, 200, 500, 1000];
      const opts = [t, ...bills.map((b) => Math.ceil(t / b) * b)].filter((v, i, a) => v >= t && a.indexOf(v) === i).slice(0, 5);
      return opts.map((v) => `<button class="btn" data-act="bill" data-v="${v}">${v === t ? 'Exacto' : money(v)}</button>`).join('');
    };
    const draw = () => {
      const t = total();
      const r = parseFloat(received) || 0;
      const change = method === 'efectivo' ? round2(r - t) : 0;
      const okDisabled = method === 'efectivo' && r < t;
      m.setHtml(`<div class="pay">
        <div class="pay-total"><small>Total a cobrar</small><b>${money(t)}</b>${o.discount ? `<small>Incluye descuento de ${money(o.discount)}</small>` : ''}</div>
        <div class="seg big">${Object.entries(PAY_METHODS).map(([k, v]) => `<button class="${k === method ? 'on' : ''}" data-act="method" data-m="${k}">${k === 'efectivo' ? '💵' : k === 'tarjeta' ? '💳' : '📲'} ${v}</button>`).join('')}</div>
        ${method === 'efectivo' ? `
          <div class="np-quick">${quick()}</div>
          <div class="pay-cash"><div><small>Recibido</small><b>${received ? money(r) : '—'}</b></div><div class="${change >= 0 ? 'ok' : 'bad'}"><small>Cambio</small><b>${received ? money(Math.max(0, change)) : '—'}</b></div></div>
          <div class="np-keys compact">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button class="np-key" data-act="k" data-k="${k}">${k}</button>`).join('')}</div>
          ${session ? '' : '<p class="warn-box">⚠️ No hay caja abierta: el efectivo no quedará en un corte. Abre la caja en “Caja”.</p>'}` : '<p class="muted center">Confirma que el pago fue recibido.</p>'}
        <div class="actions">
          ${can('cancel') ? '<button class="btn ghost" data-act="discount">🏷️ Descuento</button>' : ''}
          <button class="btn pay big" data-act="confirm" ${okDisabled ? 'disabled' : ''}>✔ Cobrar ${money(t)}</button>
        </div></div>`);
    };
    const m = openModal({
      title: `Cobrar · ${orderTitle(o)}`,
      html: '',
      onClick: async (act, a) => {
        if (act === 'method') { method = a.dataset.m; received = ''; }
        else if (act === 'bill') received = a.dataset.v;
        else if (act === 'k') {
          const k = a.dataset.k;
          if (k === '⌫') received = received.slice(0, -1);
          else if (!(k === '.' && received.includes('.')) && received.length < 9) received += k;
        } else if (act === 'discount') {
          const d = await numpad('Descuento', { hint: 'Monto en pesos. Para porcentaje usa los botones.', quick: [5, 10, 15, 20].map((p) => ({ label: `${p}%`, value: round2((Number(o.subtotal) * p) / 100) })) });
          if (d === null) return;
          const cur = get('orders', o.id);
          const disc = Math.min(Number(cur.subtotal), Math.max(0, d));
          await save([['orders', { ...cur, discount: disc, total: round2(Number(cur.subtotal) - disc) }]]);
        } else if (act === 'confirm') {
          const t = total();
          const r = method === 'efectivo' ? parseFloat(received) || t : t;
          const paid = await payOrder(get('orders', o.id), [{ method, amount: t, received: r, change: method === 'efectivo' ? round2(r - t) : 0 }]);
          m.close();
          done(paid, method === 'efectivo' ? round2(r - t) : 0);
          return;
        }
        draw();
      },
    });
    draw();
  }

  function done(paid, change) {
    const m = openModal({
      title: 'Venta registrada',
      size: 'small',
      html: `<div class="done"><div class="done-check">✔</div>
        ${change > 0 ? `<p>Cambio</p><b class="change">${money(change)}</b>` : `<p>Total</p><b class="change">${money(paid.total)}</b>`}
        <div class="actions"><button class="btn" data-act="print">🖨️ Ticket</button><button class="btn primary big" data-act="close">Nueva venta</button></div></div>`,
      onClick: (act) => { if (act === 'print') printTicket(paid); },
      onClose: () => { if (tableId && mod('tables')) go('tables'); },
    });
    order = null;
    setMeta('current_order', null);
    el.querySelector('.ticket')?.classList.remove('open');
    drawAll();
    return m;
  }

  async function orderMenu() {
    const o = order;
    const tables = mod('tables') ? sorted('tables', (t) => t.active !== 0 && t.branch_id === o.branch_id) : [];
    const m = openModal({
      title: orderTitle(o),
      size: 'small',
      html: `<div class="menu-list">
        <button data-act="rename">✏️ Nombre / referencia</button>
        ${tables.length ? '<button data-act="move">🔄 Cambiar de mesa</button>' : ''}
        <button data-act="print">🖨️ Imprimir cuenta</button>
        <button data-act="park">📌 Dejar abierta y empezar otra</button>
        ${can('cancel') || !liveItems(o.id).some((i) => i.status !== 'new') ? '<button class="danger" data-act="cancel">🗑️ Cancelar cuenta</button>' : ''}
      </div>`,
      onClick: async (act) => {
        m.close();
        if (act === 'rename') {
          const n = await promptBox('Nombre de la cuenta', { value: o.customer || '' });
          if (n !== null) await save([['orders', { ...get('orders', o.id), customer: n, kind: o.kind === 'mostrador' ? 'cuenta' : o.kind }]]);
        } else if (act === 'move') {
          const busy = new Set(openOrders().map((x) => x.table_id).filter(Boolean));
          const mm = openModal({
            title: 'Mover a mesa',
            html: `<div class="table-grid">${tables.map((t) => `<button class="table-card ${busy.has(t.id) ? 'busy' : ''}" data-act="t" data-id="${t.id}" ${busy.has(t.id) ? 'disabled' : ''}><b>${esc(t.name)}</b></button>`).join('')}</div>`,
            onClick: async (a2, b) => {
              mm.close();
              await save([['orders', { ...get('orders', o.id), table_id: b.dataset.id, kind: 'mesa' }]]);
              go('pos', { table: b.dataset.id });
            },
          });
        } else if (act === 'print') printTicket(get('orders', o.id));
        else if (act === 'park') {
          if (o.kind === 'mostrador') await save([['orders', { ...get('orders', o.id), kind: 'cuenta' }]]);
          order = null;
          await setMeta('current_order', null);
          if (tableId) go('pos'); else drawAll();
        } else if (act === 'cancel') {
          const sent = liveItems(o.id).some((i) => i.status !== 'new');
          let reason = '';
          if (sent) {
            reason = await promptBox('Motivo de cancelación', { placeholder: 'Ej. cliente se fue', ok: 'Cancelar cuenta' });
            if (reason === null) return;
          } else if (!(await confirmBox('¿Borrar esta cuenta?', { danger: true, ok: 'Borrar' }))) return;
          if (sent) await cancelOrder(get('orders', o.id), { reason, returnStock: true });
          else await save([['orders', { ...get('orders', o.id), deleted: 1 }], ...liveItems(o.id).map((i) => ['order_items', { ...i, deleted: 1 }])]);
          order = null;
          await setMeta('current_order', null);
          if (tableId && mod('tables')) go('tables'); else drawAll();
        }
      },
    });
  }

  async function itemMenu(item) {
    if (item.status === 'cancelled') return;
    const m = openModal({
      title: item.name,
      size: 'small',
      html: `<div class="menu-list">
        ${item.status === 'ready' ? '<button data-act="served">✅ Marcar como entregado</button>' : ''}
        ${can('cancel') ? '<button class="danger" data-act="cancel">❌ Cancelar producto</button>' : '<p class="muted">Pide a un encargado que cancele este producto.</p>'}
      </div>`,
      onClick: async (act) => {
        m.close();
        if (act === 'served') await setItemStatus(item, 'served');
        if (act === 'cancel') {
          const reason = await promptBox('Motivo', { placeholder: 'Ej. se equivocó el mesero', ok: 'Cancelar producto' });
          if (reason === null) return;
          const back = item.status === 'sent' ? true : await confirmBox('¿Regresar los insumos al inventario? (No si ya se preparó y se tira)', { ok: 'Sí, regresar' });
          await cancelItem(get('orders', item.order_id), item, { reason, returnStock: back });
        }
      },
    });
  }

  function printTicket(o) {
    const items = liveItems(o.id);
    const pays = list('payments', (p) => p.order_id === o.id);
    const c = cfg();
    let area = document.getElementById('print-area');
    if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.append(area); }
    area.innerHTML = `<div class="receipt">
      <h3>${esc(c.name || '')}</h3>
      <p>${new Date(o.closed_at || Date.now()).toLocaleString('es-MX')}<br>${esc(orderTitle(o))} · #${o.number}</p><hr>
      ${items.map((i) => `<div class="r-row"><span>${qty(i.qty, i.unit)} ${esc(i.name)}</span><span>${money(i.total)}</span></div>`).join('')}<hr>
      ${o.discount ? `<div class="r-row"><span>Descuento</span><span>−${money(o.discount)}</span></div>` : ''}
      <div class="r-row big"><span>TOTAL</span><span>${money(o.total)}</span></div>
      ${pays.map((p) => `<div class="r-row"><span>${esc(PAY_METHODS[p.method] || p.method)}</span><span>${money(p.received)}</span></div>${p.change_given ? `<div class="r-row"><span>Cambio</span><span>${money(p.change_given)}</span></div>` : ''}`).join('')}
      <p class="center">${esc(c.ticket_footer || '')}</p></div>`;
    window.print();
  }

  const onClick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    e.stopPropagation();
    if (act === 'cat') { cat = a.dataset.id; drawCats(); drawGrid(); }
    else if (act === 'minus') {
      const it = order && liveItems(order.id).filter((i) => i.product_id === a.dataset.id && i.status === 'new').pop();
      if (it) { await setItemQty(order, it, Number(it.qty) - (it.unit === 'pza' || !mod('weight') ? 1 : Number(it.qty))); refreshOrder(); }
    } else if (act === 'add') { const p = get('products', a.dataset.id); if (p) await add(p); }
    else if (act === 'inc' || act === 'dec') {
      const it = get('order_items', a.dataset.id);
      const step = it.unit === 'pza' || !mod('weight') ? 1 : 0.25;
      await setItemQty(order, it, round3(Number(it.qty) + (act === 'inc' ? step : -step)));
      refreshOrder();
    } else if (act === 'setqty') {
      const it = get('order_items', a.dataset.id);
      const n = await numpad(`Cantidad · ${it.name}`, { value: it.qty, unit: it.unit, decimals: it.unit !== 'pza' });
      if (n !== null) { await setItemQty(order, it, n); refreshOrder(); }
    } else if (act === 'note') {
      const it = get('order_items', a.dataset.id);
      const n = await promptBox(`Nota · ${it.name}`, { value: it.note || '', placeholder: 'Ej. sin cebolla, bien dorado, para llevar' });
      if (n !== null) { await setItemNote(order, it, n); refreshOrder(); }
    } else if (act === 'item-menu') itemMenu(get('order_items', a.dataset.id));
    else if (act === 'accounts') accountsModal();
    else if (act === 'send') await doSend();
    else if (act === 'pay') payModal();
    else if (act === 'order-menu') orderMenu();
    else if (act === 'open-cart') $('#ticket').classList.add('open');
    else if (act === 'close-cart') $('#ticket').classList.remove('open');
  };

  q.addEventListener('input', () => { search = q.value.trim(); drawGrid(); });
  q.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = q.value.trim();
    if (!code) return;
    const all = products();
    const exact = all.find((p) => p.barcode && p.barcode === code);
    const matches = all.filter((p) => p.name.toLowerCase().includes(code.toLowerCase()));
    const hit = exact || (matches.length === 1 ? matches[0] : null);
    if (hit) {
      await add(hit);
      q.value = '';
      search = '';
      drawGrid();
    } else if (!matches.length) toast('Producto no encontrado', 'error');
  });

  el.addEventListener('click', onClick);
  const off = on((changed) => {
    if (order) {
      const fresh = get('orders', order.id);
      if (!fresh || fresh.deleted || fresh.status !== 'open') {
        if (fresh?.status === 'paid' && fresh.device_id !== S.meta.device?.id) toast(`${orderTitle(fresh)} fue cobrada en otro dispositivo`, 'info');
        order = null;
        if (!tableId) setMeta('current_order', null);
      } else order = fresh;
    } else if (tableId) {
      order = orderForTable(tableId);
    }
    if (changed.has('categories') || changed.has('products')) drawCats();
    drawGrid();
    drawTicket();
  });
  drawAll();
  if (!('ontouchstart' in window)) q.focus();
  return () => { off(); el.removeEventListener('click', onClick); };
}

