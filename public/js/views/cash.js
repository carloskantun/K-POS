// Caja: apertura con fondo, entradas/salidas de efectivo y corte (esperado vs. contado).
import { S, on, get, list, save, branchId, openCashSession } from '../store.js';
import { esc, money, toast, numpad, promptBox, confirmBox, timeHM, openModal } from '../ui.js';
import { expectedCash } from '../shared/report.js';
import { PAY_METHODS } from '../shared/schema.js';
import { uid, round2 } from '../shared/util.js';

const DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

export function mount(el) {
  const data = () => ({ payments: list('payments'), cash_moves: list('cash_moves') });

  function draw() {
    const s = openCashSession();
    if (!s) {
      const last = list('cash_sessions', (x) => x.status === 'closed' && x.branch_id === branchId()).sort((a, b) => b.closed_at - a.closed_at)[0];
      el.innerHTML = `<div class="cash"><div class="view-head"><h2>Caja</h2></div>
        <div class="panel center"><div class="big-icon">🏦</div><h3>La caja está cerrada</h3><p class="muted">Abre la caja con el fondo inicial (el cambio con el que empiezas).</p>
          <button class="btn pay big" data-act="open">Abrir caja</button></div>
        ${last ? `<div class="panel"><h3>Último corte</h3>${closedSummary(last)}</div>` : ''}</div>`;
      return;
    }
    const e = expectedCash(s, data());
    const moves = list('cash_moves', (m) => m.cash_session_id === s.id).sort((a, b) => b.created_at - a.created_at);
    const opener = get('users', s.opened_by);
    const tickets = list('orders', (o) => o.cash_session_id === s.id && o.status === 'paid');
    el.innerHTML = `<div class="cash">
      <div class="view-head"><h2>Caja abierta</h2><small class="muted">Desde ${timeHM(s.opened_at)} · ${esc(opener?.name || '')}</small></div>
      <div class="kpis">
        <div class="kpi"><small>Fondo inicial</small><b>${money(e.opening)}</b></div>
        <div class="kpi"><small>Ventas en efectivo</small><b>${money(e.sales)}</b></div>
        <div class="kpi"><small>Entradas / Salidas</small><b>${money(e.ins)} / ${money(e.outs)}</b></div>
        <div class="kpi hl"><small>Debe haber en caja</small><b>${money(e.expected)}</b></div>
      </div>
      <div class="kpis">${Object.entries(e.methods).filter(([k]) => k !== 'efectivo').map(([k, v]) => `<div class="kpi"><small>${esc(PAY_METHODS[k] || k)}</small><b>${money(v)}</b></div>`).join('')}
        <div class="kpi"><small>Tickets</small><b>${tickets.length}</b></div></div>
      <div class="actions left">
        <button class="btn green" data-act="in">＋ Entrada de efectivo</button>
        <button class="btn red" data-act="out">− Salida / gasto</button>
        <button class="btn primary big" data-act="close">✂️ Hacer corte</button>
      </div>
      ${moves.length ? `<div class="panel"><h3>Movimientos</h3><table class="data"><tbody>${moves.map((m) => `<tr><td>${timeHM(m.created_at)}</td><td>${m.kind === 'in' ? 'Entrada' : 'Salida'}</td><td>${esc(m.reason || '')}</td><td class="r ${m.kind === 'in' ? 'num-pos' : 'num-neg'}">${m.kind === 'in' ? '+' : '−'}${money(m.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`;
  }

  function closedSummary(s) {
    const diff = round2((s.counted_cash || 0) - (s.expected_cash || 0));
    return `<div class="kpis">
      <div class="kpi"><small>Esperado</small><b>${money(s.expected_cash)}</b></div>
      <div class="kpi"><small>Contado</small><b>${money(s.counted_cash)}</b></div>
      <div class="kpi ${diff === 0 ? 'ok' : diff > 0 ? 'hl' : 'bad'}"><small>${diff === 0 ? 'Cuadra' : diff > 0 ? 'Sobrante' : 'Faltante'}</small><b>${money(Math.abs(diff))}</b></div>
    </div><p class="muted">${new Date(s.closed_at).toLocaleString('es-MX')} · ${esc(get('users', s.closed_by)?.name || '')}</p>`;
  }

  function closeFlow(s) {
    const e = expectedCash(s, data());
    const counts = {};
    const sum = () => round2(DENOMS.reduce((t, d) => t + d * (counts[d] || 0), 0));
    let direct = null;
    const m = openModal({
      title: 'Corte de caja',
      html: `<p class="muted">Cuenta el efectivo por denominación o escribe el total.</p>
        <div class="denoms">${DENOMS.map((d) => `<label><span>${money(d)}</span><input type="number" min="0" inputmode="numeric" data-d="${d}" placeholder="0"></label>`).join('')}</div>
        <div class="actions left"><button class="btn ghost" data-act="direct">Escribir total directo</button></div>
        <div class="pay-cash"><div><small>Contado</small><b id="counted">${money(0)}</b></div><div><small>Esperado</small><b>${money(e.expected)}</b></div><div id="diffbox"><small>Diferencia</small><b id="diff"></b></div></div>
        <label>Nota (opcional)</label><input id="note" placeholder="Ej. se pagó al proveedor de refrescos">
        <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary big" data-act="confirm">Cerrar caja</button></div>`,
      onInput: (t) => { if (t.dataset.d) { counts[t.dataset.d] = Number(t.value) || 0; direct = null; upd(); } },
      onClick: async (act) => {
        if (act === 'direct') {
          const n = await numpad('Efectivo contado', { value: direct ?? '' });
          if (n !== null) { direct = n; upd(); }
        } else if (act === 'confirm') {
          const counted = direct ?? sum();
          const diff = round2(counted - e.expected);
          if (Math.abs(diff) >= 0.01 && !(await confirmBox(`${diff > 0 ? 'Sobran' : 'Faltan'} ${money(Math.abs(diff))}. ¿Cerrar la caja así?`, { ok: 'Cerrar caja', danger: diff < 0 }))) return;
          const tickets = list('orders', (o) => o.cash_session_id === s.id && o.status === 'paid');
          const summary = {
            ...e, counted, diff, tickets: tickets.length, total: round2(tickets.reduce((t, o) => t + Number(o.total || 0), 0)),
            denominations: direct == null ? counts : null, branch: get('branches', s.branch_id)?.name, closed_by: S.user?.name,
          };
          await save([['cash_sessions', { ...get('cash_sessions', s.id), status: 'closed', closed_by: S.user?.id, closed_at: Date.now(), counted_cash: counted, expected_cash: e.expected, note: m.$('#note').value.trim(), summary }]]);
          m.close();
          toast(Math.abs(diff) < 0.01 ? '✅ Caja cerrada: cuadra' : `Caja cerrada con ${diff > 0 ? 'sobrante' : 'faltante'} de ${money(Math.abs(diff))}`, Math.abs(diff) < 0.01 ? 'ok' : 'warn', 4000);
        }
      },
    });
    const upd = () => {
      const c = direct ?? sum();
      const d = round2(c - e.expected);
      m.$('#counted').textContent = money(c);
      m.$('#diff').textContent = `${d > 0 ? '+' : ''}${money(d)}`;
      m.$('#diffbox').className = Math.abs(d) < 0.01 ? 'ok' : 'bad';
    };
    upd();
  }

  const onClick = async (ev) => {
    const a = ev.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    const s = openCashSession();
    if (act === 'open') {
      const n = await numpad('Fondo inicial de caja', { hint: 'Efectivo con el que inicias', quick: [0, 500, 1000, 2000].map((v) => ({ label: money(v), value: v })) });
      if (n === null) return;
      await save([['cash_sessions', { id: uid(), branch_id: branchId(), opened_by: S.user?.id, opened_at: Date.now(), opening_amount: n, closed_by: null, closed_at: null, counted_cash: null, expected_cash: null, status: 'open', note: '', summary: null }]]);
      toast('Caja abierta');
    } else if ((act === 'in' || act === 'out') && s) {
      const n = await numpad(act === 'in' ? 'Entrada de efectivo' : 'Salida de efectivo');
      if (!n) return;
      const reason = await promptBox('Concepto', { placeholder: act === 'in' ? 'Ej. cambio extra' : 'Ej. pago a proveedor, gas' });
      if (reason === null) return;
      await save([['cash_moves', { id: uid(), cash_session_id: s.id, branch_id: branchId(), kind: act, amount: n, reason, user_id: S.user?.id, created_at: Date.now() }]]);
    } else if (act === 'close' && s) {
      closeFlow(s);
    }
  };

  el.addEventListener('click', onClick);
  const off = on((c) => { if (c.has('cash_sessions') || c.has('cash_moves') || c.has('payments')) draw(); });
  draw();
  return () => { off(); el.removeEventListener('click', onClick); };
}
