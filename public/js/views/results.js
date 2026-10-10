import { S, list, cfg, branchId, on, can } from '../store.js';
import { api } from '../sync.js';
import { esc, money, qty } from '../ui.js';
import { computeSummary } from '../shared/report.js';
import { dayRange, localDate, shiftDate } from '../shared/util.js';
import { PAY_METHODS } from '../shared/schema.js';

export function mount(el) {
  let days = 7, date = localDate(Date.now(), cfg().timezone), scope = 'branch', snapshot = null, busy = false, error = '', disposed = false, requestId = 0, timer;
  const tz = () => cfg().timezone || 'America/Mexico_City';
  const local = () => {
    const data = Object.fromEntries(['orders','order_items','payments','cash_sessions','cash_moves','products','users','audit'].map(t => [t,list(t)]));
    data.stock = [...S.stock].map(([key,qty]) => { const [branch_id,product_id] = key.split('|'); return {branch_id,product_id,qty}; }); data.tz = tz();
    const from = shiftDate(date,1-days), start = dayRange(from,tz()).from, end = dayRange(date,tz()).to;
    const opts = {branchId:scope === 'branch' ? branchId() : null};
    return {from,to:date,days,current:computeSummary(data,{...opts,from:start,to:end}),previous:computeSummary(data,{...opts,from:dayRange(shiftDate(from,-days),tz()).from,to:start})};
  };
  const trend = (now, before) => before ? `${now >= before ? '↑' : '↓'} ${Math.abs((now-before)/before*100).toFixed(1)}% frente al periodo anterior` : now ? 'El periodo anterior no registra ventas' : 'Sin actividad en ambos periodos';
  function draw() {
    if (disposed) return;
    const r = snapshot || local(), s = r.current, p = r.previous;
    const card = (label, value, detail) => `<div class="kpi"><small>${label}</small><b>${value}</b><small class="kpi-trend">${esc(detail)}</small></div>`;
    const dates = Array.from({length:days},(_,i) => shiftDate(r.from,i)), maximum = Math.max(1,...Object.values(s.by_day || {}));
    const rows = (headers, body) => `<div class="table-wrap"><table class="data"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="muted">Sin actividad en el periodo.</td></tr>`}</tbody></table></div>`;
    el.innerHTML = `<div class="reports results"><div class="view-head"><div><h2>Resultados del negocio</h2><p class="muted">${esc(r.from)} al ${esc(r.to)} · comparación con los ${days} días anteriores</p></div><a class="btn" href="#/reports">Reporte detallado</a></div>
      <div class="result-filters"><select id="kdays" aria-label="Periodo"><option value="1" ${days===1?'selected':''}>Un día</option><option value="7" ${days===7?'selected':''}>7 días</option><option value="30" ${days===30?'selected':''}>30 días</option></select><input type="date" id="kend" value="${date}" aria-label="Hasta la fecha"><button class="btn" data-act="scope">${scope==='branch'?'Esta sucursal':'Todo el negocio'}</button><button class="btn" data-act="refresh" ${busy?'disabled':''}>${busy?'Actualizando…':'Actualizar'}</button></div>
      <p class="${error || !snapshot ? 'warn-box' : 'muted'}">${esc(error || (snapshot ? `Datos de todos los dispositivos sincronizados · actualizado ${new Date(snapshot.generated_at).toLocaleTimeString('es-MX')}` : S.meta.demo ? 'Modo local: resultados del historial guardado en este dispositivo.' : 'Vista provisional del dispositivo. Sin conexión puede faltar historial y ventas de otras cajas.'))}</p>
      <div class="kpis">${card('Ventas cobradas',money(s.total),trend(s.total,p.total))}${card('Tickets pagados',s.tickets,trend(s.tickets,p.tickets))}${card('Ticket promedio',money(s.average),trend(s.average,p.average))}${card('Propinas',money(s.tips),'Registradas aparte de las ventas')}</div>
      <div class="kpis">${card('Por cobrar ahora',money(s.open_balance || 0),`${s.open_orders} cuentas abiertas`)}${card('Mesas ocupadas ahora',s.occupied_tables || 0,'Cuentas de mesa sin cerrar')}${card('Stock bajo ahora',s.low_stock.length,`${s.inventory.length} productos con control de inventario`)}${card('Cuentas canceladas',s.cancelled_orders,`${s.cancelled_items} partidas canceladas · descuentos ${money(s.discount)}`)}</div>
      <div class="panel"><h3>Ventas por día</h3><p class="muted">Toca o coloca el cursor sobre una barra para ver el importe.</p><div class="kpi-bars" aria-label="Ventas diarias del periodo">${dates.map(d => { const value = s.by_day?.[d] || 0; return `<button class="kpi-day" data-act="day" data-date="${d}" type="button" title="${d}: ${money(value)}" aria-label="${d}: ${money(value)}"><div class="kpi-bar" style="height:${Math.max(1,value/maximum*100)}%"></div><small>${d.slice(5)}</small></button>`; }).join('')}</div><p id="day-detail" class="muted" aria-live="polite">Selecciona un día para ver su importe.</p></div>
      <div class="kpi-grid"><div class="panel"><h3>Productos que generan más ventas</h3>${rows(['Producto','Cantidad','Importe'],s.by_product.slice(0,10).map(x=>`<tr><td>${esc(x.name)}</td><td>${qty(x.qty,x.unit)}</td><td>${money(x.total)}</td></tr>`).join(''))}</div>
      <div class="panel"><h3>Equipo y cobros</h3>${rows(['Usuario','Tickets','Ventas'],s.by_user.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.tickets}</td><td>${money(x.total)}</td></tr>`).join(''))}<h3>Medios de pago</h3>${rows(['Medio','Cobrado'],Object.entries(s.by_method).map(([k,v])=>`<tr><td>${esc(PAY_METHODS[k]||k)}</td><td>${money(v)}</td></tr>`).join(''))}</div>
      <div class="panel"><h3>Cortes del periodo</h3>${rows(['Caja','Esperado','Contado','Diferencia'],s.cash.filter(x=>x.status==='closed').map(x=>`<tr><td>${esc(x.closed_by||x.opened_by)}</td><td>${money(x.expected)}</td><td>${money(x.counted)}</td><td>${money(x.diff)}</td></tr>`).join(''))}</div>
      <div class="panel"><h3>Reposición de inventario</h3>${rows(['Producto','Disponible','Mínimo'],s.low_stock.slice(0,15).map(x=>`<tr><td>${esc(x.name)}</td><td>${qty(x.qty,x.unit)}</td><td>${qty(x.min,x.unit)}</td></tr>`).join(''))}${can('inventory')?'<a class="btn small" href="#/inventory">Abrir inventario</a>':''}</div></div><p class="muted">Ventas por fecha de cobro y zona horaria del negocio. Inventario, mesas y cuentas abiertas muestran el estado actual. Las ventas offline aparecen después de sincronizar.</p></div>`;
  }
  async function refresh() {
    const id = ++requestId;
    if (S.meta.demo) { snapshot=null; draw(); return; }
    busy=true; error=''; draw();
    try { const r=await api(`/api/reports/kpis?date=${date}&days=${days}${scope==='branch'?`&branch=${encodeURIComponent(branchId())}`:''}`); if (!disposed && id===requestId) snapshot=r; }
    catch { if (id===requestId) { snapshot=null; error='Sin conexión: resultados parciales del dispositivo; la comparación puede estar incompleta.'; } }
    finally { if (id===requestId) { busy=false; draw(); } }
  }
  const change = e => { if(e.target.id==='kdays') days=Number(e.target.value); else if(e.target.id==='kend' && e.target.value) date=e.target.value; else return; snapshot=null; refresh(); };
  const click = e => { const target=e.target.closest('[data-act]'),act=target?.dataset.act; if(act==='day') { const d=target.dataset.date; el.querySelector('#day-detail').textContent=`${d}: ${money((snapshot || local()).current.by_day?.[d] || 0)}`; } else if(act==='scope') { scope=scope==='branch'?'all':'branch'; snapshot=null; refresh(); } else if(act==='refresh') refresh(); };
  el.addEventListener('change',change); el.addEventListener('click',click);
  const off=on(c=> { if([...c].some(t=>['orders','payments','stock_moves','cash_sessions','order_items'].includes(t))) { clearTimeout(timer); timer=setTimeout(refresh,800); } });
  draw(); refresh();
  return ()=> { disposed=true; ++requestId; clearTimeout(timer); off(); el.removeEventListener('change',change); el.removeEventListener('click',click); };
}
