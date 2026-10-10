// Reportes del día: ventas, métodos de pago, productos, usuarios, caja e inventario.
import { S, on, list, cfg, branchId } from '../store.js';
import { api } from '../sync.js';
import { esc, money, qty, toast, promptBox } from '../ui.js';
import { toCSV, download } from '../shared/csv.js';
import { computeSummary } from '../shared/report.js';
import { PAY_METHODS } from '../shared/schema.js';
import { localDate, dayRange, shiftDate } from '../shared/util.js';

export function mount(el) {
  const tz = () => cfg().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let date = localDate(Date.now(), tz());
  let scope = 'branch';
  let remote = null;
  let loading = false;

  const localData = () => ({
    orders: list('orders'), order_items: list('order_items'), payments: list('payments'),
    cash_sessions: list('cash_sessions'), cash_moves: list('cash_moves'), products: list('products'), users: list('users'), audit: list('audit'),
    stock: [...S.stock.entries()].map(([k, qty2]) => { const [b, p] = k.split('|'); return { branch_id: b, product_id: p, qty: qty2 }; }),
    tz: tz(),
  });

  const old = () => date < shiftDate(localDate(Date.now(), tz()), -5);

  async function fetchRemote() {
    if (S.meta.demo || !old()) { remote = null; return; }
    loading = true;
    draw();
    try {
      remote = await api(`/api/reports/summary?date=${date}${scope === 'branch' ? `&branch=${branchId()}` : ''}`);
    } catch {
      remote = null;
      toast('Sin conexión: solo hay datos de los últimos días en este dispositivo', 'warn', 3500);
    }
    loading = false;
    draw();
  }

  function draw() {
    const { from, to } = dayRange(date, tz());
    const s = remote || computeSummary(localData(), { from, to, branchId: scope === 'branch' ? branchId() : null });
    const maxHour = Math.max(1, ...s.by_hour);
    const hours = s.by_hour.map((v, h) => ({ v, h })).filter((x, i, a) => a.slice(0, i + 1).some((y) => y.v) && a.slice(i).some((y) => y.v));
    const branches = list('branches').length;
    el.innerHTML = `<div class="reports">
      <div class="view-head"><h2>Reportes</h2><a class="btn small" href="#/results">Ver resultados y KPIs</a>
        <div class="date-nav"><button class="btn" data-act="prev">◀</button><input type="date" id="date" value="${date}"><button class="btn" data-act="next">▶</button><button class="btn ghost" data-act="today">Hoy</button></div></div>
      ${branches > 1 ? `<div class="seg"><button class="${scope === 'branch' ? 'on' : ''}" data-act="scope" data-s="branch">Esta sucursal</button><button class="${scope === 'all' ? 'on' : ''}" data-act="scope" data-s="all">Todas</button></div>` : ''}
      ${loading ? '<p class="muted">Cargando de la nube…</p>' : ''}
      ${old() && !remote && !loading ? '<p class="warn-box">Este dispositivo guarda solo los últimos 7 días. Conéctate a internet para ver fechas anteriores.</p>' : ''}
      <div class="kpis">
        <div class="kpi hl"><small>Ventas</small><b>${money(s.total)}</b></div>
        <div class="kpi"><small>Tickets</small><b>${s.tickets}</b></div>
        <div class="kpi"><small>Ticket promedio</small><b>${money(s.average)}</b></div>
        <div class="kpi ${s.cancelled_orders || s.cancelled_items ? 'bad' : ''}"><small>Cancelaciones</small><b>${s.cancelled_orders + s.cancelled_items}</b></div>
        ${s.tips ? `<div class="kpi"><small>Propinas</small><b>${money(s.tips)}</b></div>` : ''}
      </div>
      <div class="kpis">${Object.entries(s.by_method).map(([k, v]) => `<div class="kpi"><small>${esc(PAY_METHODS[k] || k)}</small><b>${money(v)}</b></div>`).join('') || ''}</div>
      <div class="report-grid">
        <section class="panel"><h3>Ventas por hora</h3>
          ${hours.length ? `<div class="bars">${hours.map(({ v, h }) => `<div class="bar" title="${h}:00 · ${money(v)}"><span style="height:${Math.round((v / maxHour) * 100)}%"></span><small>${h}</small></div>`).join('')}</div>` : '<p class="empty">Sin ventas</p>'}
        </section>
        <section class="panel"><h3>Más vendidos</h3>
          <table class="data"><tbody>${s.by_product.slice(0, 15).map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${qty(p.qty, p.unit)}</td><td class="r">${money(p.total)}</td></tr>`).join('') || '<tr><td class="empty">Sin ventas</td></tr>'}</tbody></table>
        </section>
        <section class="panel"><h3>Por usuario</h3>
          <table class="data"><tbody>${s.by_user.map((u) => `<tr><td>${esc(u.name)}</td><td class="r">${u.tickets} tickets</td><td class="r">${money(u.total)}${u.tips ? `<br><small class="muted">+${money(u.tips)} propina</small>` : ''}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table>
        </section>
        <section class="panel"><h3>Caja</h3>
          ${s.cash.map((c) => `<p>${c.status === 'open' ? `🟢 Abierta (${esc(c.opened_by)}) · debe haber <b>${money(c.expected)}</b>` : `✂️ Corte (${esc(c.closed_by)}) · esperado ${money(c.expected)}, contado ${money(c.counted)} → <b class="${c.diff === 0 ? 'num-pos' : 'num-neg'}">${c.diff === 0 ? 'cuadra' : (c.diff > 0 ? '+' : '') + money(c.diff)}</b>`}</p>`).join('') || '<p class="empty">Sin movimientos de caja</p>'}
        </section>
        <section class="panel"><h3>🔒 Cancelaciones y descuentos</h3>
          ${(s.audit || []).map((a) => `<p><small class="muted">${new Date(a.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</small> <b>${esc({ cancel_item: 'Canceló', cancel_order: 'Canceló cuenta', discount: 'Descuento', cash_out: 'Salida', reopen: 'Reabrió', stock_adjust: 'Ajuste' }[a.action] || a.action)}</b> ${a.amount ? money(a.amount) : ''} · ${esc(a.detail)} <small class="muted">(${esc(a.user)}${a.authorized && a.authorized !== a.user ? `, autorizó ${esc(a.authorized)}` : ''})</small></p>`).join('') || '<p class="empty">Sin cancelaciones</p>'}
        </section>
        <section class="panel"><h3>Stock bajo</h3>
          ${s.low_stock.map((i) => `<p>🔴 ${esc(i.name)}: <b>${qty(i.qty, i.unit)}</b> <small class="muted">(mín. ${qty(i.min, i.unit)})</small></p>`).join('') || '<p class="empty">✅ Todo en orden</p>'}
        </section>
      </div>
      <div class="actions left">
        <button class="btn" data-act="csv">⬇ Ventas del día (CSV)</button>
        ${!S.meta.demo ? '<button class="btn" data-act="csv-range">⬇ Ventas por rango (CSV)</button><button class="btn" data-act="telegram">📨 Enviar resumen a Telegram</button>' : ''}
      </div>
    </div>`;
  }

  const onClick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'prev') date = shiftDate(date, -1);
    else if (act === 'next') date = shiftDate(date, 1);
    else if (act === 'today') date = localDate(Date.now(), tz());
    else if (act === 'scope') scope = a.dataset.s;
    else if (act === 'csv') { exportLocal(); return; }
    else if (act === 'csv-range') {
      const from = await promptBox('Desde', { type: 'date', value: date.slice(0, 8) + '01', ok: 'Siguiente' });
      if (!from) return;
      const to = await promptBox('Hasta', { type: 'date', value: date, ok: 'Descargar' });
      if (!to) return;
      try {
        const res = await fetch(`/api/export/sales?from=${from}&to=${to}`, { headers: { authorization: `Bearer ${S.meta.device.token}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo exportar');
        download(`ventas-${from}_${to}.csv`, await res.text());
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    else if (act === 'telegram') {
      try {
        const r = await api('/api/telegram/test', { method: 'POST', body: { kind: 'today' } });
        toast(r.sent ? `Enviado a ${r.sent} chat(s)` : 'No hay chats vinculados: ve a Ajustes → Telegram', r.sent ? 'ok' : 'warn', 3500);
      } catch (err) { toast(err.message, 'error'); }
      return;
    } else return;
    await fetchRemote();
    draw();
  };
  // Exporta las ventas del día seleccionado con los datos del dispositivo (funciona sin internet).
  function exportLocal() {
    const { from, to } = dayRange(date, tz());
    const orders = list('orders', (o) => ['paid', 'cancelled'].includes(o.status) && o.closed_at >= from && o.closed_at < to).sort((a, b) => a.closed_at - b.closed_at);
    const rows = [];
    for (const o of orders) {
      const pays = list('payments', (p) => p.order_id === o.id);
      const t = o.table_id && S.data.tables.get(o.table_id);
      list('order_items', (i) => i.order_id === o.id).forEach((i, k) => rows.push({
        fecha: date, hora: new Date(o.closed_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }), ticket: o.number,
        cuenta: [t?.name, o.customer].filter(Boolean).join(' · '), estado: i.status === 'cancelled' || o.status === 'cancelled' ? 'cancelado' : 'pagado',
        producto: i.name, extras: (i.mods || []).map((m) => m.name).join(', '), cantidad: i.qty, precio: i.price, importe: i.total,
        mesero: S.data.users.get(o.user_id)?.name || '', metodo_pago: [...new Set(pays.map((p) => PAY_METHODS[p.method] || p.method))].join(' + '),
        total_ticket: k === 0 ? o.total : '', descuento: k === 0 && o.discount ? o.discount : '', propina: k === 0 ? pays.reduce((s2, p) => s2 + (Number(p.tip) || 0), 0) || '' : '',
      }));
    }
    download(`ventas-${date}.csv`, toCSV(rows, ['fecha', 'hora', 'ticket', 'cuenta', 'estado', 'producto', 'extras', 'cantidad', 'precio', 'importe', 'mesero', 'metodo_pago', 'total_ticket', 'descuento', 'propina']));
  }

  const onChange = async (e) => { if (e.target.id === 'date' && e.target.value) { date = e.target.value; await fetchRemote(); draw(); } };
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  const off = on((c) => { if (!remote && (c.has('orders') || c.has('payments') || c.has('cash_sessions'))) draw(); });
  draw();
  return () => { off(); el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); };
}
