// Ajustes: negocio, catálogo, usuarios, mesas, sucursales, dispositivo, nube y Telegram.
import { S, on, get, list, sorted, save, cfg, setMeta, tenantId, branchId, stockOf, enqueueEverything, resetDevice, newAccount } from '../store.js';
import { api, syncNow } from '../sync.js';
import { esc, money, visual, avatar, toast, openModal, confirmBox, promptBox, imageToDataUrl, qty } from '../ui.js';
import { MODULES, PRESETS } from '../shared/presets.js';
import { modifiersEditor } from '../modifiers.js';
import { toCSV, parseCSV, download, productFromRow, PRODUCT_COLUMNS } from '../shared/csv.js';
import { printerCfg, savePrinterCfg, connect as connectPrinter, printTest, support as printSupport } from '../printer.js';
import { ROLES } from '../shared/schema.js';
import { uid, pinHash, round3 } from '../shared/util.js';

const SECTIONS = [
  ['business', '🏪 Negocio'], ['products', '🏷️ Productos'], ['categories', '🗂️ Categorías'], ['users', '👥 Usuarios'],
  ['tables', '🍽️ Mesas'], ['branches', '🏬 Sucursales'], ['device', '📱 Dispositivos'], ['telegram', '📨 Telegram'],
];
const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'];
const UNITS = { pza: 'Pieza', kg: 'Kilo', g: 'Gramo', lt: 'Litro', ml: 'Mililitro', m: 'Metro' };

const setCfg = (patch) => save([['config', { ...(get('config', 'business') || { id: 'business' }), id: 'business', value: { ...cfg(), ...patch } }]]);

export function mount(el, params) {
  let section = params.s || 'business';
  let search = '';

  function draw() {
    el.innerHTML = `<div class="settings">
      <nav class="set-nav">${SECTIONS.map(([k, v]) => `<button class="${section === k ? 'on' : ''}" data-act="section" data-s="${k}">${v}</button>`).join('')}</nav>
      <div class="set-body" id="sb"></div></div>`;
    drawSection();
  }

  function drawSection() {
    const sb = el.querySelector('#sb');
    const fn = { business, products, categories, users, tables, branches, device, telegram }[section];
    sb.innerHTML = fn();
    if (section === 'telegram') loadTelegram();
    if (section === 'device') loadDevices();
  }

  // ---------- Negocio ----------
  function business() {
    const c = cfg();
    return `<h2>Negocio</h2><form class="form" id="biz">
      <label>Nombre</label><input name="name" value="${esc(c.name || '')}">
      <label>Giro</label><select name="type">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${p.emoji} ${esc(p.label)}</option>`).join('')}</select>
      <h3>Funciones</h3><div class="toggles">${Object.entries(MODULES).map(([k, m]) => `<label class="toggle"><input type="checkbox" name="mod_${k}" ${c.modules?.[k] ? 'checked' : ''}><span><b>${esc(m.label)}</b><small>${esc(m.help)}</small></span></label>`).join('')}</div>
      <h3>Reglas</h3>
      <label class="toggle"><input type="checkbox" name="waiters_can_charge" ${c.waiters_can_charge !== false ? 'checked' : ''}><span><b>Los meseros pueden cobrar</b><small>Si no, solo caja/encargado cobra</small></span></label>
      <label class="toggle"><input type="checkbox" name="allow_negative_stock" ${c.allow_negative_stock !== false ? 'checked' : ''}><span><b>Vender aunque el sistema diga agotado</b><small>Solo muestra un aviso</small></span></label>
      <label>Zona horaria</label><input name="timezone" value="${esc(c.timezone || '')}">
      <label>Moneda</label><input name="currency" value="${esc(c.currency || 'MXN')}" maxlength="3">
      <label>Encabezado del ticket (dirección, teléfono, RFC)</label><textarea name="ticket_header" rows="2">${esc(c.ticket_header || '')}</textarea>
      <label>Pie del ticket</label><input name="ticket_footer" value="${esc(c.ticket_footer || '')}">
      <div class="actions left"><button class="btn primary">Guardar</button></div></form>
      ${!S.meta.demo && S.user?.role === 'owner' ? '<div class="panel"><h3>🔑 Cuenta en la nube</h3><p class="muted">Correo y contraseña del dueño para conectar dispositivos y entrar al sistema.</p><button class="btn" data-act="change-pass">Cambiar contraseña</button></div>' : ''}
      ${S.meta.demo ? `<div class="panel"><h3>☁️ Conectar a la nube</h3><p class="muted">Ahora tus datos viven solo en este dispositivo. Crea tu cuenta para usar meseros/cocina en otros dispositivos, tener respaldo y recibir reportes por Telegram. No se pierde nada de lo que ya capturaste.</p><button class="btn primary" data-act="go-cloud">Crear cuenta en la nube</button></div>` : ''}`;
  }

  // ---------- Productos ----------
  function products() {
    const s = search.toLowerCase();
    const prods = sorted('products', (p) => !s || p.name.toLowerCase().includes(s) || (p.barcode || '').includes(s));
    return `<div class="view-head"><h2>Productos</h2><div class="inline">
        <button class="btn" data-act="export-products" title="Descargar para Excel">⬇ CSV</button>
        <label class="btn" title="Subir desde Excel (guardar como CSV)">⬆ Importar<input type="file" accept=".csv,text/csv" id="import-csv" hidden></label>
        <button class="btn primary" data-act="new-product">＋ Nuevo producto</button></div></div>
      <div class="search"><span>🔎</span><input id="ps" type="search" value="${esc(search)}" placeholder="Buscar…"></div>
      <div class="inv-list">${prods.map((p) => `<button class="inv-row clickable ${p.active === 0 ? 'inactive' : ''}" data-act="edit-product" data-id="${p.id}">
        ${visual(p, 'sm')}<div class="ir-info"><b>${esc(p.name)}</b><small>${esc(get('categories', p.category_id)?.name || 'Sin categoría')}${p.sellable === 0 ? ' · insumo' : ''}${p.station ? ` · ${esc(p.station)}` : ''}${p.track_stock ? ` · stock ${qty(stockOf(p.id), p.unit)}` : ''}${(p.recipe || []).length ? ' · receta' : ''}${(p.modifiers || []).length ? ' · extras' : ''}</small></div>
        <div class="ir-qty"><b>${p.sellable === 0 ? '—' : money(p.price)}</b></div></button>`).join('')}</div>`;
  }

  function productForm(p) {
    const isNew = !p;
    p = p || { id: uid(), name: '', price: 0, unit: 'pza', emoji: '🏷️', image: '', station: '', track_stock: 0, stock_min: 0, recipe: [], active: 1, sellable: 1, cost: 0, sort: list('products').length };
    let image = p.image || '';
    let recipe = [...(p.recipe || [])];
    const modEd = modifiersEditor(p.modifiers, { selfId: p.id });
    const c = cfg();
    const stations = [...new Set(['cocina', 'barra', ...list('products', (x) => x.station).map((x) => x.station)])];
    const ingredients = () => sorted('products', (x) => x.id !== p.id && x.track_stock);
    const recipeHtml = () => recipe.map((r, i) => `<div class="recipe-row"><select data-r="${i}" data-f="product_id">${ingredients().map((x) => `<option value="${x.id}" ${x.id === r.product_id ? 'selected' : ''}>${esc(x.name)} (${esc(x.unit)})</option>`).join('')}</select><input type="number" step="any" min="0" data-r="${i}" data-f="qty" value="${r.qty}"><button type="button" class="icon-btn" data-act="rm-comp" data-i="${i}">✕</button></div>`).join('');
    const m = openModal({
      title: isNew ? 'Nuevo producto' : p.name,
      size: 'wide',
      html: `<form class="form cols" id="pf">
        <div class="photo-box"><div id="pic">${visual({ ...p, image })}</div>
          <label class="btn small">📷 Foto<input type="file" accept="image/*" capture="environment" id="file" hidden></label>
          ${image ? '<button type="button" class="btn small ghost" data-act="rm-photo">Quitar foto</button>' : ''}
          <label>Emoji (si no hay foto)</label><input name="emoji" value="${esc(p.emoji || '')}" maxlength="4" class="emoji-in"></div>
        <div>
          <label>Nombre</label><input name="name" required value="${esc(p.name)}" autofocus>
          <div class="row2"><div><label>Precio</label><input name="price" type="number" step="any" min="0" value="${p.price ?? 0}"></div>
            <div><label>Se vende por</label><select name="unit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}" ${p.unit === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
          <div class="row2"><div><label>Categoría</label><select name="category_id"><option value="">—</option>${sorted('categories').map((x) => `<option value="${x.id}" ${x.id === p.category_id ? 'selected' : ''}>${esc(x.emoji || '')} ${esc(x.name)}</option>`).join('')}</select></div>
            <div><label>Costo</label><input name="cost" type="number" step="any" min="0" value="${p.cost ?? 0}"></div></div>
          ${c.modules?.kitchen ? `<label>Se prepara en (comanda)</label><select name="station"><option value="">No va a comanda (se entrega directo)</option>${stations.map((s) => `<option value="${s}" ${p.station === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
          ${c.modules?.barcode ? `<label>Código de barras</label><input name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric">` : ''}
          ${c.modules?.wholesale ? `<div class="row2"><div><label>Precio mayoreo</label><input name="price_wholesale" type="number" step="any" value="${p.price_wholesale ?? ''}"></div><div><label>A partir de</label><input name="wholesale_min" type="number" step="any" value="${p.wholesale_min ?? ''}"></div></div>` : ''}
          <label class="toggle"><input type="checkbox" name="track_stock" ${p.track_stock ? 'checked' : ''}><span><b>Controlar inventario</b><small>Descuenta existencias al vender</small></span></label>
          <div class="row2"><div><label>Stock mínimo (alerta)</label><input name="stock_min" type="number" step="any" min="0" value="${p.stock_min ?? 0}"></div>
            ${isNew ? '<div><label>Existencia inicial</label><input name="initial" type="number" step="any" min="0" value=""></div>' : `<div><label>Existencia actual</label><input disabled value="${qty(stockOf(p.id), p.unit)}"></div>`}</div>
          <label class="toggle"><input type="checkbox" name="sellable" ${p.sellable !== 0 ? 'checked' : ''}><span><b>Aparece en venta</b><small>Desactiva para insumos (tortillas, carne, leche…)</small></span></label>
          <label class="toggle"><input type="checkbox" name="active" ${p.active !== 0 ? 'checked' : ''}><span><b>Activo</b></span></label>
          ${c.modules?.recipes ? `<h3>Receta / insumos por unidad vendida</h3><p class="muted small">Ej. 1 taco = 2 tortillas + 0.035 kg de carne; 1 cubeta = 6 cervezas.</p><div id="recipe">${recipeHtml()}</div><button type="button" class="btn small" data-act="add-comp">＋ Insumo</button>` : ''}
          <h3>Extras y variantes</h3><p class="muted small">Ej. Salsa (BBQ, Búfalo, Mango habanero), Término (medio, 3/4, bien cocido), Extras (+ queso $15). Se preguntan al vender y salen en la comanda.</p>
          <div id="mods-box">${modEd.html()}</div>
        </div>
        <div class="actions full">${!isNew ? '<button type="button" class="btn danger ghost" data-act="del">Eliminar</button>' : ''}<button type="button" class="btn" data-act="close">Cancelar</button><button class="btn primary big">Guardar</button></div>
      </form>`,
      onClick: async (act, a) => {
        if (act === 'add-comp') {
          const first = ingredients()[0];
          if (!first) return toast('Primero crea insumos con "Controlar inventario" activado', 'warn', 3500);
          recipe.push({ product_id: first.id, qty: 1 });
          m.$('#recipe').innerHTML = recipeHtml();
        } else if (act === 'rm-comp') {
          recipe.splice(Number(a.dataset.i), 1);
          m.$('#recipe').innerHTML = recipeHtml();
        } else if (act === 'rm-photo') {
          image = '';
          m.$('#pic').innerHTML = visual({ emoji: m.$('[name=emoji]').value });
        } else if (act === 'del') {
          if (!(await confirmBox(`¿Eliminar ${p.name}?`, { danger: true, ok: 'Eliminar' }))) return;
          await save([['products', { ...p, deleted: 1 }]]);
          m.close();
        }
      },
      onInput: (t) => {
        if (t.dataset.r != null) recipe[Number(t.dataset.r)][t.dataset.f] = t.dataset.f === 'qty' ? Number(t.value) : t.value;
      },
    });
    modEd.bind(m.$('#mods-box'));
    m.$('#file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      image = await imageToDataUrl(f);
      m.$('#pic').innerHTML = visual({ image });
    };
    m.el.addEventListener('change', (e) => { if (e.target.dataset?.r != null) recipe[Number(e.target.dataset.r)][e.target.dataset.f] = e.target.dataset.f === 'qty' ? Number(e.target.value) : e.target.value; });
    m.$('#pf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const num = (n) => (f[n] && f[n].value !== '' ? Number(f[n].value) : null);
      const row = {
        ...p, name: f.name.value.trim(), price: num('price') || 0, unit: f.unit.value, category_id: f.category_id.value || null,
        cost: num('cost') || 0, emoji: f.emoji.value.trim(), image, station: f.station ? f.station.value : p.station || '',
        barcode: f.barcode ? f.barcode.value.trim() : p.barcode || '', price_wholesale: f.price_wholesale ? num('price_wholesale') : p.price_wholesale ?? null,
        wholesale_min: f.wholesale_min ? num('wholesale_min') : p.wholesale_min ?? null, track_stock: f.track_stock.checked ? 1 : 0,
        stock_min: num('stock_min') || 0, sellable: f.sellable.checked ? 1 : 0, active: f.active.checked ? 1 : 0,
        recipe: recipe.filter((r) => r.product_id && r.qty > 0),
        modifiers: modEd.value(),
      };
      const rows = [['products', row]];
      const initial = num('initial');
      if (isNew && initial && row.track_stock) {
        rows.push(['stock_moves', { id: uid(), branch_id: branchId(), product_id: row.id, qty: round3(initial), kind: 'count', ref_id: null, note: 'Inventario inicial', user_id: S.user?.id, created_at: Date.now(), cost: row.cost }]);
      }
      await save(rows);
      m.close();
      toast('Producto guardado');
    };
  }

  function exportProducts() {
    const rows = sorted('products').map((p) => ({
      nombre: p.name, categoria: get('categories', p.category_id)?.name || '', precio: p.price, costo: p.cost, unidad: p.unit,
      codigo_barras: p.barcode || '', emoji: p.emoji || '', estacion: p.station || '', inventario: p.track_stock ? 'si' : 'no',
      stock_minimo: p.stock_min || 0, existencia: p.track_stock ? stockOf(p.id) : '', en_venta: p.sellable === 0 ? 'no' : 'si',
      precio_mayoreo: p.price_wholesale ?? '', mayoreo_desde: p.wholesale_min ?? '',
    }));
    download(`productos-${(cfg().name || 'kpos').replace(/\W+/g, '-').toLowerCase()}.csv`, toCSV(rows, PRODUCT_COLUMNS));
  }

  async function importProducts(file) {
    const parsed = parseCSV(await file.text()).map(productFromRow).filter(Boolean);
    if (!parsed.length) return toast('El archivo no tiene productos. Usa la columna "nombre".', 'error', 4000);
    const existing = list('products');
    const byCode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode, p]));
    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
    const cats = new Map(list('categories').map((c) => [c.name.toLowerCase(), c]));
    const rows = [];
    let created = 0;
    let updated = 0;
    for (const r of parsed) {
      let catId = null;
      if (r.category) {
        let c = cats.get(r.category.toLowerCase());
        if (!c) {
          c = { id: uid(), name: r.category, emoji: '🏷️', color: COLORS[cats.size % COLORS.length], sort: cats.size, active: 1 };
          cats.set(r.category.toLowerCase(), c);
          rows.push(['categories', c]);
        }
        catId = c.id;
      }
      const cur = (r.barcode && byCode.get(r.barcode)) || byName.get(r.name.toLowerCase());
      const { stock, category, ...fields } = r;
      const prod = cur
        ? { ...cur, ...fields, emoji: fields.emoji || cur.emoji, category_id: catId ?? cur.category_id, station: fields.station || cur.station || '' }
        : { id: uid(), image: '', recipe: [], modifiers: [], active: 1, sort: existing.length + created, ...fields, emoji: fields.emoji || '🏷️', category_id: catId };
      if (cur) updated += 1; else created += 1;
      rows.push(['products', prod]);
      if (stock != null && prod.track_stock) {
        const diff = round3(stock - stockOf(prod.id));
        if (diff) rows.push(['stock_moves', { id: uid(), branch_id: branchId(), product_id: prod.id, qty: diff, kind: 'count', ref_id: null, note: 'Importación CSV', user_id: S.user?.id, created_at: Date.now(), cost: prod.cost }]);
      }
    }
    if (!(await confirmBox(`Se crearán ${created} y se actualizarán ${updated} productos. ¿Continuar?`, { ok: 'Importar' }))) return;
    await save(rows);
    toast(`Importados: ${created} nuevos, ${updated} actualizados`);
  }

  // ---------- Categorías ----------
  function categories() {
    return `<div class="view-head"><h2>Categorías</h2><button class="btn primary" data-act="new-cat">＋ Nueva</button></div>
      <div class="inv-list">${sorted('categories').map((c) => `<button class="inv-row clickable" data-act="edit-cat" data-id="${c.id}"><span class="pic emoji sm" style="background:${esc(c.color)}22">${esc(c.emoji || '🗂️')}</span><div class="ir-info"><b>${esc(c.name)}</b><small>${list('products', (p) => p.category_id === c.id).length} productos</small></div></button>`).join('')}</div>`;
  }

  function catForm(c) {
    c = c || { id: uid(), name: '', emoji: '🏷️', color: COLORS[0], sort: list('categories').length, active: 1 };
    const m = openModal({
      title: c.name || 'Nueva categoría', size: 'small',
      html: `<form class="form" id="cf"><label>Nombre</label><input name="name" required value="${esc(c.name)}" autofocus>
        <label>Emoji</label><input name="emoji" value="${esc(c.emoji || '')}" maxlength="4" class="emoji-in">
        <label>Color</label><div class="colors">${COLORS.map((x) => `<label><input type="radio" name="color" value="${x}" ${c.color === x ? 'checked' : ''}><span style="background:${x}"></span></label>`).join('')}</div>
        <div class="actions">${c.name ? '<button type="button" class="btn danger ghost" data-act="del">Eliminar</button>' : ''}<button class="btn primary">Guardar</button></div></form>`,
      onClick: async (act) => {
        if (act === 'del' && (await confirmBox('¿Eliminar categoría? Los productos quedan sin categoría.', { danger: true }))) {
          await save([['categories', { ...c, deleted: 1 }]]);
          m.close();
        }
      },
    });
    m.$('#cf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      await save([['categories', { ...c, name: f.name.value.trim(), emoji: f.emoji.value.trim(), color: f.color.value }]]);
      m.close();
    };
  }

  // ---------- Usuarios ----------
  function users() {
    return `<div class="view-head"><h2>Usuarios</h2><button class="btn primary" data-act="new-user">＋ Nuevo usuario</button></div>
      <p class="muted">Cada persona entra con su PIN. El rol define qué puede ver: los meseros toman pedidos, cocina solo ve comandas.</p>
      <div class="inv-list">${sorted('users').map((u) => `<button class="inv-row clickable ${u.active === 0 ? 'inactive' : ''}" data-act="edit-user" data-id="${u.id}">${avatar(u)}<div class="ir-info"><b>${esc(u.name)}</b><small>${esc(ROLES[u.role]?.label || u.role)}${u.branch_id ? ` · ${esc(get('branches', u.branch_id)?.name || '')}` : ''}</small></div></button>`).join('')}</div>`;
  }

  function userForm(u) {
    const isNew = !u;
    u = u || { id: uid(), name: '', role: 'mesero', color: COLORS[list('users').length % COLORS.length], active: 1, branch_id: null };
    const brs = list('branches');
    const m = openModal({
      title: isNew ? 'Nuevo usuario' : u.name, size: 'small',
      html: `<form class="form" id="uf"><label>Nombre</label><input name="name" required value="${esc(u.name)}" autofocus>
        <label>Rol</label><select name="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
        <label>PIN (4 dígitos)${isNew ? '' : ' — deja vacío para no cambiarlo'}</label><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" ${isNew ? 'required' : ''}>
        ${brs.length > 1 ? `<label>Sucursal</label><select name="branch_id"><option value="">Todas</option>${brs.map((b) => `<option value="${b.id}" ${u.branch_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
        <label>Color</label><div class="colors">${COLORS.map((x) => `<label><input type="radio" name="color" value="${x}" ${u.color === x ? 'checked' : ''}><span style="background:${x}"></span></label>`).join('')}</div>
        <label class="toggle"><input type="checkbox" name="active" ${u.active !== 0 ? 'checked' : ''}><span><b>Activo</b></span></label>
        <div class="actions"><button class="btn primary">Guardar</button></div></form>`,
    });
    m.$('#uf').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const pin = f.pin.value.trim();
      if (pin && !/^\d{4}$/.test(pin)) return toast('El PIN debe tener 4 dígitos', 'error');
      if (pin && list('users', (x) => x.id !== u.id && x.pin_hash === pinHash(tenantId(), pin)).length) return toast('Ese PIN ya lo usa otra persona', 'error');
      const owners = list('users', (x) => x.role === 'owner' && x.active !== 0 && x.id !== u.id);
      if (u.role === 'owner' && (f.role.value !== 'owner' || !f.active.checked) && !owners.length) return toast('Debe quedar al menos un dueño activo', 'error');
      await save([['users', { ...u, name: f.name.value.trim(), role: f.role.value, color: f.color.value, active: f.active.checked ? 1 : 0, branch_id: f.branch_id ? f.branch_id.value || null : u.branch_id, pin_hash: pin ? pinHash(tenantId(), pin) : u.pin_hash }]]);
      m.close();
      toast('Usuario guardado');
    };
  }

  // ---------- Mesas ----------
  function tables() {
    const ts = sorted('tables', (t) => t.branch_id === branchId());
    return `<div class="view-head"><h2>Mesas</h2><div><button class="btn" data-act="bulk-tables">＋ Varias</button> <button class="btn primary" data-act="new-table">＋ Mesa</button></div></div>
      ${cfg().modules?.tables ? '' : '<p class="warn-box">El módulo de mesas está apagado. Actívalo en Negocio → Funciones.</p>'}
      <div class="table-grid">${ts.map((t) => `<button class="table-card free" data-act="edit-table" data-id="${t.id}"><b>${esc(t.name)}</b><small>${esc(t.zone || '')}</small></button>`).join('')}</div>`;
  }

  async function tableForm(t) {
    const name = await promptBox(t ? 'Editar mesa' : 'Nueva mesa', { value: t?.name || `Mesa ${list('tables').length + 1}`, label: 'Nombre' });
    if (name === null) return;
    if (t && name === '') {
      if (await confirmBox(`¿Eliminar ${t.name}?`, { danger: true })) await save([['tables', { ...t, deleted: 1 }]]);
      return;
    }
    const zone = await promptBox('Zona (opcional)', { value: t?.zone || '', placeholder: 'Ej. Terraza, Salón, Barra' });
    await save([['tables', { ...(t || { id: uid(), branch_id: branchId(), sort: list('tables').length + 1, active: 1 }), name, zone: zone || '' }]]);
  }

  // ---------- Sucursales ----------
  function branches() {
    return `<div class="view-head"><h2>Sucursales</h2><button class="btn primary" data-act="new-branch">＋ Sucursal</button></div>
      <p class="muted">El catálogo es el mismo para todas; el inventario, las mesas y la caja son por sucursal.</p>
      <div class="inv-list">${sorted('branches').map((b) => `<div class="inv-row"><span class="pic emoji sm">🏬</span><div class="ir-info"><b>${esc(b.name)}</b><small>${esc(b.address || '')}</small></div>
        ${b.id === branchId() ? '<span class="tag green">Este dispositivo</span>' : `<button class="btn small" data-act="use-branch" data-id="${b.id}">Usar aquí</button>`}
        <button class="btn small" data-act="edit-branch" data-id="${b.id}">✎</button></div>`).join('')}</div>`;
  }

  // ---------- Dispositivos ----------
  function device() {
    const d = S.meta.device || {};
    return `<h2>Este dispositivo</h2>
      <div class="form">
        <label>Nombre</label><div class="inline"><input id="dname" value="${esc(d.name || '')}"><button class="btn" data-act="dev-name">Guardar</button></div>
        <label>Modo</label><div class="seg"><button class="${d.mode !== 'kitchen' ? 'on' : ''}" data-act="dev-mode" data-m="pos">🛒 Punto de venta</button><button class="${d.mode === 'kitchen' ? 'on' : ''}" data-act="dev-mode" data-m="kitchen">👨‍🍳 Pantalla de cocina</button></div>
        <p class="muted small">En modo cocina se abre directo en Comandas (ideal para la tableta del taquero o la barra).</p>
      </div>
      ${S.meta.demo ? '' : `<div class="panel"><h3>Conectar otro dispositivo</h3><p class="muted">Abre K-POS en el celular del mesero o la tablet de cocina, elige “Conectar este dispositivo” y escribe:</p>
        <p>Cuenta: <b>${esc(S.meta.tenant?.slug || '')}</b></p><div id="code-box"><button class="btn primary" data-act="link-code">Generar código</button></div></div>
        <div class="panel"><h3>Dispositivos conectados</h3><div id="devs" class="muted">Cargando…</div></div>
        <div class="panel"><h3>Sincronización</h3><p class="muted">${S.pending ? `${S.pending} cambios esperando subir.` : 'Todo sincronizado.'} ${S.lastSync ? `Última: ${new Date(S.lastSync).toLocaleTimeString('es-MX')}` : ''}</p><button class="btn" data-act="sync">🔄 Sincronizar ahora</button></div>`}
      ${printerPanel()}
      <div class="panel"><h3>Almacenamiento</h3>
        <p class="muted">${S.persisted ? '✅ El navegador conservará los datos de este dispositivo.' : '⚠️ El navegador podría borrar los datos locales si no se usa en días. Instala la app en la pantalla de inicio (Compartir → Agregar a inicio en iPhone/iPad, o menú ⋮ → Instalar en Android).'}</p></div>
      <div class="panel"><h3>Otro negocio en este dispositivo</h3><p class="muted">Útil si el dueño maneja varios negocios desde su celular. Cada uno guarda sus datos por separado.</p>
        <button class="btn" data-act="add-account">＋ Agregar otro negocio</button></div>
      <div class="panel danger-zone"><h3>Zona de peligro</h3><p class="muted">Borra los datos de este dispositivo${S.meta.demo ? ' (en modo local se pierde todo)' : ' (lo que ya se subió queda en la nube)'}.</p><button class="btn danger" data-act="reset">Desvincular y borrar datos locales</button></div>`;
  }

  function printerPanel() {
    const c = printerCfg();
    const stations = [...new Set(list('products', (p) => p.station).map((p) => p.station))];
    return `<div class="panel"><h3>🖨️ Impresora de este dispositivo</h3>
      <div class="seg">${[['system', 'Del sistema / AirPrint'], ['bluetooth', 'Bluetooth térmica'], ['serial', 'USB térmica'], ['none', 'Ninguna']].map(([k, v]) => `<button class="${c.type === k ? 'on' : ''}" data-act="pr-type" data-t="${k}" ${(k === 'bluetooth' && !printSupport.bluetooth) || (k === 'serial' && !printSupport.serial) ? 'disabled title="Este navegador no lo permite"' : ''}>${v}</button>`).join('')}</div>
      ${c.device_name && c.type !== 'system' ? `<p class="muted">Conectada: <b>${esc(c.device_name)}</b></p>` : ''}
      ${!printSupport.bluetooth ? '<p class="muted small">En iPhone/iPad usa una impresora compatible con AirPrint (opción "Del sistema").</p>' : ''}
      <div class="form">
        <label>Ancho de papel</label><div class="seg">${[58, 80].map((w) => `<button class="${Number(c.width) === w ? 'on' : ''}" data-act="pr-width" data-w="${w}">${w} mm</button>`).join('')}</div>
        <label class="toggle"><input type="checkbox" data-pr="auto_receipt" ${c.auto_receipt ? 'checked' : ''}><span><b>Imprimir ticket al cobrar</b></span></label>
        <label class="toggle"><input type="checkbox" data-pr="auto_kitchen" ${c.auto_kitchen ? 'checked' : ''}><span><b>Imprimir comandas que lleguen</b><small>Activa esto en el dispositivo que tiene la impresora de cocina o barra</small></span></label>
        ${stations.length ? `<div class="hours">${stations.map((st) => `<label><input type="checkbox" data-pr-st="${esc(st)}" ${!c.stations.length || c.stations.includes(st) ? 'checked' : ''}><span>${esc(st)}</span></label>`).join('')}</div>` : ''}
      </div>
      <div class="actions left"><button class="btn" data-act="pr-test">Imprimir prueba</button></div></div>`;
  }

  async function loadDevices() {
    const box = el.querySelector('#devs');
    if (!box) return;
    try {
      const r = await api('/api/devices');
      box.innerHTML = r.devices.filter((d) => !d.revoked).map((d) => `<div class="inv-row"><span class="pic emoji sm">📱</span><div class="ir-info"><b>${esc(d.name)}${d.id === r.current ? ' (este)' : ''}</b><small>Última conexión: ${d.last_seen ? new Date(d.last_seen).toLocaleString('es-MX') : '—'}</small></div>${d.id === r.current ? '' : `<button class="btn small danger ghost" data-act="revoke" data-id="${d.id}">Quitar acceso</button>`}</div>`).join('');
    } catch {
      box.textContent = 'Sin conexión.';
    }
  }

  // ---------- Telegram ----------
  function telegram() {
    const c = cfg();
    if (S.meta.demo) return '<h2>Telegram</h2><p class="warn-box">Los reportes por Telegram requieren la cuenta en la nube (Ajustes → Negocio → Conectar a la nube).</p>';
    return `<h2>Reportes por Telegram</h2>
      <p class="muted">Recibe cada mañana el resumen de ayer (ventas, caja, inventario), el corte de caja al cerrar y alertas de stock bajo, en tu chat o en un grupo con los socios.</p>
      <div class="panel"><h3>1. Vincular un chat o grupo</h3><div id="tg-code"><button class="btn primary" data-act="tg-code">Generar código</button></div></div>
      <div class="panel"><h3>2. Horarios</h3><form class="form" id="tgf">
        <label>Hora del resumen del día anterior</label><select name="report_hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(c.report_hour ?? 8) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>
        <label>Avisos de “cómo va el día” (opcional)</label><div class="hours">${Array.from({ length: 24 }, (_, h) => `<label><input type="checkbox" name="ph" value="${h}" ${(c.progress_hours || []).map(Number).includes(h) ? 'checked' : ''}><span>${h}</span></label>`).join('')}</div>
        <div class="actions left"><button class="btn primary">Guardar horarios</button></div></form></div>
      <div class="panel"><h3>Chats vinculados</h3><div id="tg-chats" class="muted">Cargando…</div>
        <div class="actions left"><button class="btn" data-act="tg-test">📨 Enviar resumen de hoy</button><button class="btn" data-act="tg-test-y">📨 Enviar resumen de ayer</button></div></div>`;
  }

  async function loadTelegram() {
    const box = el.querySelector('#tg-chats');
    if (!box) return;
    try {
      const r = await api('/api/telegram/chats');
      if (!r.configured) box.innerHTML = '<p class="warn-box">El bot aún no está configurado en el servidor (TELEGRAM_BOT_TOKEN).</p>';
      else box.innerHTML = r.chats.map((c) => `<div class="inv-row"><span class="pic emoji sm">💬</span><div class="ir-info"><b>${esc(c.title || c.chat_id)}</b></div><button class="btn small danger ghost" data-act="tg-unlink" data-id="${esc(c.chat_id)}">Desvincular</button></div>`).join('') || 'Ningún chat vinculado todavía.';
    } catch {
      box.textContent = 'Sin conexión.';
    }
  }

  function cloudForm() {
    const m = openModal({
      title: 'Crear cuenta en la nube', size: 'small',
      html: `<form class="form" id="cl"><label>Nombre de tu cuenta (subdominio)</label><input name="slug" required pattern="[a-z0-9\\-]{3,30}" value="${esc((cfg().name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}">
        <label>Correo</label><input name="email" type="email" required><label>Contraseña</label><input name="password" type="password" minlength="6" required>
        <p class="error" id="err"></p><div class="actions"><button class="btn primary big">Crear y subir mis datos</button></div></form>`,
    });
    m.$('#cl').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const r = await api('/api/register', { method: 'POST', auth: false, body: { tenant_id: tenantId(), slug: f.slug.value, name: cfg().name, business_type: cfg().type, email: f.email.value, password: f.password.value, device_name: S.meta.device?.name } });
        await setMeta('device', { ...S.meta.device, id: r.device_id, token: r.token });
        await setMeta('tenant', r.tenant);
        await setMeta('demo', false);
        await setMeta('cursor', 0);
        await enqueueEverything();
        m.close();
        toast('¡Cuenta creada! Subiendo tus datos…');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        m.$('#err').textContent = err.message || 'Sin conexión';
      }
    };
  }

  // ---------- Eventos ----------
  const onClick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    const id = a.dataset.id;
    if (act === 'section') { section = a.dataset.s; search = ''; draw(); return; }
    if (act === 'new-product') productForm();
    else if (act === 'export-products') exportProducts();
    else if (act === 'edit-product') productForm(get('products', id));
    else if (act === 'new-cat') catForm();
    else if (act === 'edit-cat') catForm(get('categories', id));
    else if (act === 'new-user') userForm();
    else if (act === 'edit-user') userForm(get('users', id));
    else if (act === 'new-table') tableForm();
    else if (act === 'edit-table') tableForm(get('tables', id));
    else if (act === 'bulk-tables') {
      const n = parseInt(await promptBox('¿Cuántas mesas crear?', { value: '10', type: 'number' }), 10);
      if (!n || n < 1 || n > 200) return;
      const start = list('tables', (t) => t.branch_id === branchId()).length;
      await save(Array.from({ length: n }, (_, i) => ['tables', { id: uid(), branch_id: branchId(), name: `Mesa ${start + i + 1}`, zone: '', sort: start + i + 1, active: 1 }]));
    } else if (act === 'new-branch' || act === 'edit-branch') {
      const b = id ? get('branches', id) : null;
      const name = await promptBox(b ? 'Editar sucursal' : 'Nueva sucursal', { value: b?.name || '', label: 'Nombre' });
      if (!name) return;
      const address = await promptBox('Dirección (opcional)', { value: b?.address || '' });
      await save([['branches', { ...(b || { id: uid(), active: 1 }), name, address: address || '' }]]);
    } else if (act === 'use-branch') {
      if (await confirmBox(`¿Cambiar este dispositivo a ${get('branches', id).name}?`)) { await setMeta('branch_id', id); await setMeta('current_order', null); location.reload(); }
    } else if (act === 'dev-name') {
      await setMeta('device', { ...S.meta.device, name: el.querySelector('#dname').value.trim() });
      toast('Guardado');
    } else if (act === 'dev-mode') {
      await setMeta('device', { ...S.meta.device, mode: a.dataset.m });
      drawSection();
      toast(a.dataset.m === 'kitchen' ? 'Modo cocina: al entrar se abrirá Comandas' : 'Modo punto de venta');
    } else if (act === 'link-code' || act === 'tg-code') {
      try {
        const r = await api('/api/link-code', { method: 'POST', body: { purpose: act === 'tg-code' ? 'telegram' : 'device' } });
        const box = el.querySelector(act === 'tg-code' ? '#tg-code' : '#code-box');
        box.innerHTML = act === 'tg-code'
          ? `<p>Agrega el bot ${r.bot ? `<a href="https://t.me/${esc(r.bot)}?start=${r.code}" target="_blank" rel="noopener">@${esc(r.bot)}</a>` : ''} a tu chat o grupo y envía:</p><p class="code">/vincular ${r.code}</p><p class="muted small">Vence en 15 minutos.</p>`
          : `<p class="code">${r.code}</p><p class="muted small">Vence en 15 minutos.</p>`;
      } catch (err) { toast(err.message, 'error'); }
    } else if (act === 'revoke') {
      if (!(await confirmBox('¿Quitar acceso a este dispositivo?', { danger: true }))) return;
      await api('/api/devices/revoke', { method: 'POST', body: { id } });
      loadDevices();
    } else if (act === 'sync') { await syncNow(); drawSection(); toast('Sincronizado'); }
    else if (act === 'reset') {
      if (S.pending && !S.meta.demo && !(await confirmBox(`Hay ${S.pending} cambios sin subir que se perderán. ¿Continuar?`, { danger: true }))) return;
      if (!(await confirmBox('¿Borrar todos los datos de este dispositivo?', { danger: true, ok: 'Borrar' }))) return;
      await resetDevice();
      location.hash = '';
      location.reload();
    } else if (act === 'tg-test' || act === 'tg-test-y') {
      try {
        const r = await api('/api/telegram/test', { method: 'POST', body: { kind: act === 'tg-test' ? 'today' : 'yesterday' } });
        toast(r.sent ? `Enviado a ${r.sent} chat(s)` : 'No hay chats vinculados', r.sent ? 'ok' : 'warn');
      } catch (err) { toast(err.message, 'error'); }
    } else if (act === 'tg-unlink') {
      await api(`/api/telegram/chats?chat_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      loadTelegram();
    } else if (act === 'pr-type') {
      try {
        const name = await connectPrinter(a.dataset.t);
        toast(`Impresora: ${name}`);
      } catch (err) { if (err.name !== 'NotFoundError') toast(err.message, 'error'); }
      drawSection();
    } else if (act === 'pr-width') { await savePrinterCfg({ width: Number(a.dataset.w) }); drawSection(); }
    else if (act === 'pr-test') printTest();
    else if (act === 'go-cloud') cloudForm();
    else if (act === 'add-account') newAccount();
    else if (act === 'change-pass') {
      const current = await promptBox('Contraseña actual', { type: 'password', ok: 'Continuar' });
      if (!current) return;
      const password = await promptBox('Nueva contraseña', { type: 'password', label: 'Mínimo 6 caracteres', ok: 'Cambiar' });
      if (!password) return;
      try { await api('/api/password/change', { method: 'POST', body: { current, password } }); toast('Contraseña actualizada'); } catch (err) { toast(err.message, 'error'); }
    }
  };

  const onSubmit = async (e) => {
    if (e.target.id === 'biz') {
      e.preventDefault();
      const f = e.target;
      const modules = Object.fromEntries(Object.keys(MODULES).map((k) => [k, f[`mod_${k}`].checked]));
      await setCfg({ name: f.name.value.trim(), type: f.type.value, modules, waiters_can_charge: f.waiters_can_charge.checked, allow_negative_stock: f.allow_negative_stock.checked, timezone: f.timezone.value.trim() || 'America/Mexico_City', currency: f.currency.value.trim().toUpperCase() || 'MXN', ticket_footer: f.ticket_footer.value, ticket_header: f.ticket_header.value });
      toast('Guardado');
    } else if (e.target.id === 'tgf') {
      e.preventDefault();
      const f = e.target;
      await setCfg({ report_hour: Number(f.report_hour.value), progress_hours: [...f.querySelectorAll('[name=ph]:checked')].map((x) => Number(x.value)) });
      toast('Horarios guardados');
    }
  };

  const onChange = async (e) => {
    const t = e.target;
    if (t.id === 'import-csv' && t.files[0]) { await importProducts(t.files[0]); t.value = ''; return; }
    if (t.dataset.pr) await savePrinterCfg({ [t.dataset.pr]: t.checked });
    if (t.dataset.prSt != null) {
      const all = [...el.querySelectorAll('[data-pr-st]')];
      const on2 = all.filter((x) => x.checked).map((x) => x.dataset.prSt);
      await savePrinterCfg({ stations: on2.length === all.length ? [] : on2 });
    }
  };

  const onInput = (e) => {
    if (e.target.id === 'ps') {
      search = e.target.value;
      drawSection();
      const n = el.querySelector('#ps');
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }
  };

  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  const off = on((c) => {
    const relevant = { products: ['products', 'categories', 'stock_moves'], categories: ['categories', 'products'], users: ['users'], tables: ['tables'], branches: ['branches'] }[section];
    if (relevant && relevant.some((t) => c.has(t))) drawSection();
  });
  draw();
  return () => { off(); el.removeEventListener('click', onClick); el.removeEventListener('submit', onSubmit); el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); };
}
