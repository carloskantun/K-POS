// Reportes del día: ventas, métodos de pago, productos, usuarios, caja e inventario.
import { S, on, list, cfg, branchId } from '../store.js';
import { api } from '../sync.js';
import { esc, money, qty, toast } from '../ui.js';
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
    cash_sessions: list('cash_sessions'), cash_moves: list('cash_moves'), products: list('products'), users: list('users'),
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
      <div class="view-head"><h2>Reportes</h2>
        <div class="date-nav"><button class="btn" data-act="prev">◀</button><input type="date" id="date" value="${date}"><button class="btn" data-act="next">▶</button><button class="btn ghost" data-act="today">Hoy</button></div></div>
      ${branches > 1 ? `<div class="seg"><button class="${scope === 'branch' ? 'on' : ''}" data-act="scope" data-s="branch">Esta sucursal</button><button class="${scope === 'all' ? 'on' : ''}" data-act="scope" data-s="all">Todas</button></div>` : ''}
      ${loading ? '<p class="muted">Cargando de la nube…</p>' : ''}
      ${old() && !remote && !loading ? '<p class="warn-box">Este dispositivo guarda solo los últimos 7 días. Conéctate a internet para ver fechas anteriores.</p>' : ''}
      <div class="kpis">
        <div class="kpi hl"><small>Ventas</small><b>${money(s.total)}</b></div>
        <div class="kpi"><small>Tickets</small><b>${s.tickets}</b></div>
        <div class="kpi"><small>Ticket promedio</small><b>${money(s.average)}</b></div>
        <div class="kpi ${s.cancelled_orders || s.cancelled_items ? 'bad' : ''}"><small>Cancelaciones</small><b>${s.cancelled_orders + s.cancelled_items}</b></div>
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
          <table class="data"><tbody>${s.by_user.map((u) => `<tr><td>${esc(u.name)}</td><td class="r">${u.tickets} tickets</td><td class="r">${money(u.total)}</td></tr>`).join('') || '<tr><td class="empty">—</td></tr>'}</tbody></table>
        </section>
        <section class="panel"><h3>Caja</h3>
          ${s.cash.map((c) => `<p>${c.status === 'open' ? `🟢 Abierta (${esc(c.opened_by)}) · debe haber <b>${money(c.expected)}</b>` : `✂️ Corte (${esc(c.closed_by)}) · esperado ${money(c.expected)}, contado ${money(c.counted)} → <b class="${c.diff === 0 ? 'num-pos' : 'num-neg'}">${c.diff === 0 ? 'cuadra' : (c.diff > 0 ? '+' : '') + money(c.diff)}</b>`}</p>`).join('') || '<p class="empty">Sin movimientos de caja</p>'}
        </section>
        <section class="panel"><h3>Stock bajo</h3>
          ${s.low_stock.map((i) => `<p>🔴 ${esc(i.name)}: <b>${qty(i.qty, i.unit)}</b> <small class="muted">(mín. ${qty(i.min, i.unit)})</small></p>`).join('') || '<p class="empty">✅ Todo en orden</p>'}
        </section>
      </div>
      ${!S.meta.demo ? `<div class="actions left"><button class="btn" data-act="telegram">📨 Enviar resumen a Telegram</button></div>` : ''}
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
  const onChange = async (e) => { if (e.target.id === 'date' && e.target.value) { date = e.target.value; await fetchRemote(); draw(); } };
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  const off = on((c) => { if (!remote && (c.has('orders') || c.has('payments') || c.has('cash_sessions'))) draw(); });
  draw();
  return () => { off(); el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); };
}
