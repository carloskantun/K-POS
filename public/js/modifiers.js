// Extras y variantes: "Salsa: BBQ / Búfalo", "Término: medio / 3/4", "Queso extra +$15".
// En el producto: modifiers = [{ id, name, required, max, options: [{ id, name, price, product_id?, qty? }] }]
import { sorted } from './store.js';
import { esc, money, openModal } from './ui.js';
import { uid, round2 } from './shared/util.js';

export const hasModifiers = (p) => (p?.modifiers || []).some((g) => (g.options || []).length);

// Pregunta extras/variantes al vender. Resuelve { mods, qty, note } o null si se cancela.
export function pickModifiers(p, { price = Number(p.price) || 0 } = {}) {
  const groups = (p.modifiers || []).filter((g) => (g.options || []).length);
  const chosen = new Map(groups.map((g) => [g.id, []]));
  let qty = 1;
  let note = '';
  return new Promise((resolve) => {
    const ok = () => groups.every((g) => !g.required || chosen.get(g.id).length > 0);
    const extra = () => round2(groups.reduce((t, g) => t + chosen.get(g.id).reduce((s, oid) => s + Number(g.options.find((o) => o.id === oid)?.price || 0), 0), 0));
    const limit = (g) => (Number(g.max) > 0 ? Number(g.max) : g.required && !Number(g.max) ? 1 : 99);
    const draw = () => {
      const unit = round2(price + extra());
      m.setHtml(`<div class="mods">
        ${groups.map((g) => {
          const lim = limit(g);
          return `<section><h3>${esc(g.name)} <small class="muted">${g.required ? (lim === 1 ? 'elige 1' : `obligatorio, hasta ${lim}`) : lim === 99 ? 'opcional' : `opcional, hasta ${lim}`}</small></h3>
          <div class="mod-opts">${g.options.map((o) => `<button class="mod-opt ${chosen.get(g.id).includes(o.id) ? 'on' : ''}" data-act="opt" data-g="${g.id}" data-o="${o.id}">${esc(o.name)}${Number(o.price) ? `<small>+${money(o.price)}</small>` : ''}</button>`).join('')}</div></section>`;
        }).join('')}
        <label class="muted">Nota para cocina/barra</label><input id="mnote" value="${esc(note)}" placeholder="Ej. sin hielo, bien cocida">
        <div class="mod-foot">
          <div class="stepper"><button class="step red" data-act="dec">−</button><span>${qty}</span><button class="step green" data-act="inc">+</button></div>
          <button class="btn pay big" data-act="ok" ${ok() ? '' : 'disabled'}>Agregar ${money(unit * qty)}</button>
        </div></div>`);
      m.$('#mnote').oninput = (e) => { note = e.target.value; };
    };
    const m = openModal({
      title: `${p.emoji || ''} ${p.name}`,
      html: '',
      onClick: (act, a) => {
        if (act === 'opt') {
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
          const mods = [];
          for (const g of groups) {
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
        <label class="check"><input type="checkbox" data-gi="${gi}" data-f="required" ${g.required ? 'checked' : ''}> Obligatorio</label>
        <label class="check">Máx. <input type="number" min="0" data-gi="${gi}" data-f="max" value="${g.max ?? ''}" placeholder="∞" class="tiny"></label>
        <button type="button" class="icon-btn" data-act="mg-del" data-gi="${gi}" title="Quitar grupo">✕</button></div>
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
        else if (f === 'price' || f === 'max' || f === 'qty') target[f] = t.value === '' ? null : Number(t.value);
        else target[f] = t.value || (f === 'product_id' ? null : '');
      };
      box.addEventListener('input', onEdit);
      box.addEventListener('change', onEdit);
    },
    value() {
      return groups
        .map((g) => ({ ...g, name: g.name.trim(), options: g.options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim(), price: Number(o.price) || 0 })) }))
        .filter((g) => g.name && g.options.length);
    },
  };
}
