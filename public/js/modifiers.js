// Extras y variantes: "Salsa: BBQ / Búfalo", "Término: medio / 3/4", "Queso extra +$15".
// En el producto: modifiers = [{ id, name, required, max, options: [{ id, name, price, product_id?, qty? }] }]
import { sorted } from './store.js';
import { esc, money, openModal } from './ui.js';
import { isAllocation, allocated, allocationMods } from './shared/combinations.js';
import { uid, round2 } from './shared/util.js';

export const hasModifiers = (p) => (p?.modifiers || []).some((g) => (g.options || []).length);

// Pregunta extras/variantes al vender. Resuelve { mods, qty, note } o null si se cancela.
export function pickModifiers(p, { price = Number(p.price) || 0 } = {}) {
  const groups = (p.modifiers || []).filter((g) => (g.options || []).length);
  const chosen = new Map(groups.map((g) => [g.id, []]));
  const counts = new Map(groups.filter(isAllocation).map(g => [g.id, {}]));
  let qty = 1;
  let note = '';
  return new Promise((resolve) => {
    const ok = () => groups.every(g => isAllocation(g) ? allocated(counts.get(g.id)) === Number(g.total) : !g.required || chosen.get(g.id).length > 0);
    const extra = () => round2(groups.reduce((t, g) => t + (isAllocation(g) ? g.options.reduce((s,o) => s + Number(o.price || 0) * (counts.get(g.id)[o.id] || 0),0) : chosen.get(g.id).reduce((s, oid) => s + Number(g.options.find(o => o.id === oid)?.price || 0),0)),0));
    const limit = (g) => (Number(g.max) > 0 ? Number(g.max) : g.required && !Number(g.max) ? 1 : 99);
    const draw = () => {
      const unit = round2(price + extra());
      m.setHtml(`<div class="mods"><div class="mod-scroll">
        ${groups.map((g) => {
          if (isAllocation(g)) {
            const selected = counts.get(g.id), used = allocated(selected), remaining = Number(g.total) - used;
            return `<section class="allocation"><h3>${esc(g.name)}</h3><p role="status">${used} de ${g.total} ${esc(g.unit || 'piezas')} asignadas · ${remaining ? `Faltan ${remaining}` : 'Combinación completa'}</p>
              <p class="muted">Reparte las piezas de cada paquete entre uno o varios sabores.</p>
              ${g.options.map(o => `<div class="allocation-row"><div><b>${esc(o.name)}</b>${Number(o.price) ? `<small>+${money(o.price)} por pieza</small>` : ''}</div>
                <div class="allocation-controls"><button type="button" class="btn small" data-act="fill" data-g="${g.id}" data-o="${o.id}" ${remaining ? '' : 'disabled'}>Restantes</button>
                <input aria-label="${esc(o.name)}: cantidad" data-count data-g="${g.id}" data-o="${o.id}" type="number" min="0" max="${g.total}" step="1" value="${selected[o.id] || 0}"></div></div>`).join('')}</section>`;
          }
          const lim = limit(g);
          return `<section><h3>${esc(g.name)} <small class="muted">${g.required ? (lim === 1 ? 'elige 1' : `obligatorio, hasta ${lim}`) : lim === 99 ? 'opcional' : `opcional, hasta ${lim}`}</small></h3>
          <div class="mod-opts">${g.options.map((o) => `<button class="mod-opt ${chosen.get(g.id).includes(o.id) ? 'on' : ''}" data-act="opt" data-g="${g.id}" data-o="${o.id}">${esc(o.name)}${Number(o.price) ? `<small>+${money(o.price)}</small>` : ''}</button>`).join('')}</div></section>`;
        }).join('')}
        <label class="muted">Nota para cocina/barra</label><input id="mnote" value="${esc(note)}" placeholder="Ej. sin hielo, bien cocida">
        <p class="muted">La combinación se aplica a cada paquete. Para otra combinación, agrega una partida nueva.</p></div><div class="mod-foot">
          <div class="stepper"><button class="step red" data-act="dec">−</button><span>${qty}</span><button class="step green" data-act="inc">+</button></div>
          <button class="btn pay big" data-act="ok" ${ok() ? '' : 'disabled'}>Agregar ${money(unit * qty)}</button>
        </div></div>`);
      m.el.querySelectorAll('[data-count]').forEach(input => { input.oninput = () => {
        const g = groups.find(g => g.id === input.dataset.g), selected = counts.get(g.id);
        const rest = Number(g.total) - allocated(selected) + (selected[input.dataset.o] || 0);
        selected[input.dataset.o] = Math.min(rest, Math.max(0, Math.floor(Number(input.value) || 0)));
        input.value = selected[input.dataset.o];
        const used = allocated(selected), remaining = Number(g.total) - used;
        input.closest('section').querySelector('[role=status]').textContent = `${used} de ${g.total} ${g.unit || 'piezas'} asignadas · ${remaining ? `Faltan ${remaining}` : 'Combinación completa'}`;
        input.closest('section').querySelectorAll('[data-act=fill]').forEach(b => { b.disabled = !remaining; });
        const add = m.$('[data-act=ok]'); add.disabled = !ok(); add.textContent = `Agregar ${money((price + extra()) * qty)}`;
      }; });
      m.$('#mnote').oninput = (e) => { note = e.target.value; };
    };
    const m = openModal({
      title: `${p.emoji || ''} ${p.name}`,
      html: '',
      size: 'combination-modal',
      onClick: (act, a) => {
        if (act === 'fill') { const g = groups.find(g => g.id === a.dataset.g); const selected = counts.get(g.id); selected[a.dataset.o] = (selected[a.dataset.o] || 0) + Number(g.total) - allocated(selected); }
        else if (act === 'opt') {
          const g = groups.find((x) => x.id === a.dataset.g);
          const list = chosen.get(g.id);
          const i = list.indexOf(a.dataset.o);
          const lim = limit(g);
          if (i >= 0) list.splice(i, 1);
          else if (lim === 1) list.splice(0, list.length, a.dataset.o);
          else if (list.length < lim) list.push(a.dataset.o);
        } else if (act === 'inc') qty += 1;
        else if (act === 'dec') qty = Math.max(1, qty - 1);
        else if (act === 'ok') {
          if (!ok()) return;
          const mods = [];
          for (const g of groups) {
            if (isAllocation(g)) { mods.push(...allocationMods(g, counts.get(g.id))); continue; }
            for (const oid of chosen.get(g.id)) {
              const o = g.options.find((x) => x.id === oid);
              mods.push({ g: g.name, name: o.name, price: Number(o.price) || 0, ...(o.product_id ? { product_id: o.product_id, qty: Number(o.qty) || 1 } : {}) });
            }
          }
          return m.close({ mods, qty, note: note.trim() });
        }
        draw();
      },
      onClose: (r) => resolve(r ?? null),
    });
    draw();
  });
}

// Editor dentro del formulario de producto. Devuelve { html, bind(container), value() }.
export function modifiersEditor(initial, { selfId }) {
  let groups = structuredClone(initial || []);
  const stockProducts = () => sorted('products', (x) => x.id !== selfId && x.track_stock);
  const html = () => `<div class="mod-editor">${groups.map((g, gi) => `<div class="mod-group">
      <div class="mg-head"><input data-gi="${gi}" data-f="name" value="${esc(g.name)}" placeholder="Nombre del grupo (ej. Salsa, Término, Extras)">
        <select data-gi="${gi}" data-f="type" aria-label="Tipo de opciones"><option value="choice">Elegir opciones</option><option value="allocation" ${g.type === 'allocation' ? 'selected' : ''}>Repartir piezas / combinar</option></select>
        ${g.type === 'allocation' ? `<label>Total por paquete <input type="number" min="1" max="1000" step="1" data-gi="${gi}" data-f="total" value="${g.total || 10}" class="tiny"></label><input data-gi="${gi}" data-f="unit" value="${esc(g.unit || 'piezas')}" placeholder="Unidad: tacos, piezas">` : ''}
        <label class="check"><input type="checkbox" data-gi="${gi}" data-f="required" ${g.required ? 'checked' : ''} ${g.type === 'allocation' ? 'disabled' : ''}> Obligatorio</label>
        <label class="check">Máx. <input type="number" min="0" data-gi="${gi}" data-f="max" value="${g.max ?? ''}" placeholder="∞" class="tiny" ${g.type === 'allocation' ? 'disabled' : ''}></label>
        <button type="button" class="icon-btn" data-act="mg-del" data-gi="${gi}" title="Quitar grupo">✕</button></div>
      ${g.type === 'allocation' ? '<p class="muted small">Completa el total por paquete. El precio extra y el consumo de inventario de cada opción son por pieza asignada; el máximo de opciones no limita el reparto.</p>' : ''}
      ${(g.options || []).map((o, oi) => `<div class="mo-row">
        <input data-gi="${gi}" data-oi="${oi}" data-f="name" value="${esc(o.name)}" placeholder="Opción">
        <input type="number" step="any" data-gi="${gi}" data-oi="${oi}" data-f="price" value="${o.price ?? 0}" title="Precio extra" class="small-in">
        <select data-gi="${gi}" data-oi="${oi}" data-f="product_id" title="Descuenta del inventario"><option value="">Sin inventario</option>${stockProducts().map((x) => `<option value="${x.id}" ${x.id === o.product_id ? 'selected' : ''}>− ${esc(x.name)}</option>`).join('')}</select>
        <input type="number" step="any" min="0" data-gi="${gi}" data-oi="${oi}" data-f="qty" value="${o.qty ?? ''}" placeholder="cant." class="tiny" title="Cantidad a descontar">
        <button type="button" class="icon-btn" data-act="mo-del" data-gi="${gi}" data-oi="${oi}">✕</button></div>`).join('')}
      <button type="button" class="btn small" data-act="mo-add" data-gi="${gi}">＋ Opción</button>
    </div>`).join('')}
    <button type="button" class="btn small" data-act="mg-add">＋ Grupo de extras / variantes</button></div>`;

  return {
    html,
    bind(box) {
      const redraw = () => { box.innerHTML = html(); };
      box.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        const gi = Number(a.dataset.gi);
        if (a.dataset.act === 'mg-add') groups.push({ id: uid(), name: '', required: false, max: null, options: [{ id: uid(), name: '', price: 0 }] });
        else if (a.dataset.act === 'mg-del') groups.splice(gi, 1);
        else if (a.dataset.act === 'mo-add') groups[gi].options.push({ id: uid(), name: '', price: 0 });
        else if (a.dataset.act === 'mo-del') groups[gi].options.splice(Number(a.dataset.oi), 1);
        else return;
        e.stopPropagation();
        redraw();
      });
      const onEdit = (e) => {
        const t = e.target;
        if (t.dataset.gi == null) return;
        const g = groups[Number(t.dataset.gi)];
        const target = t.dataset.oi != null ? g.options[Number(t.dataset.oi)] : g;
        const f = t.dataset.f;
        if (f === 'required') target.required = t.checked;
        else if (f === 'price' || f === 'max' || f === 'qty' || f === 'total') target[f] = t.value === '' ? null : Number(t.value);
        else if (f === 'type') { target.type = t.value; if (t.value === 'allocation') { target.total ||= 10; target.unit ||= 'piezas'; target.required = true; } redraw(); }
        else target[f] = t.value || (f === 'product_id' ? null : '');
      };
      box.addEventListener('input', onEdit);
      box.addEventListener('change', onEdit);
    },
    value() {
      return groups
        .map((g) => ({ ...g, ...(g.type === 'allocation' ? { total: Math.max(1, Math.min(1000, Math.floor(Number(g.total) || 1))), required: true } : {}), name: g.name.trim(), options: g.options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim(), price: Number(o.price) || 0 })) }))
        .filter((g) => g.name && g.options.length);
    },
  };
}
