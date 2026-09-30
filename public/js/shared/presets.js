// Giros de negocio: cada uno activa módulos y trae un catálogo de ejemplo editable.
import { uid, pinHash } from './util.js';

export const MODULES = {
  tables: { label: 'Mesas', help: 'Cuentas por mesa, mapa de mesas' },
  kitchen: { label: 'Comandas', help: 'Pantalla de cocina/barra con pedidos pendientes' },
  waiters: { label: 'Meseros', help: 'Cada mesero entra con su PIN y ve sus cuentas' },
  recipes: { label: 'Recetas / insumos', help: 'Descuenta insumos proporcionales (tortillas, carne, cervezas por cubeta)' },
  barcode: { label: 'Código de barras', help: 'Buscar y agregar productos escaneando' },
  weight: { label: 'Venta a granel', help: 'Venta por kilo/litro con teclado numérico' },
  wholesale: { label: 'Mayoreo', help: 'Precio especial a partir de cierta cantidad' },
};

// p(key, nombre, emoji, precio, categoría, opciones)
const p = (key, name, emoji, price, cat, o = {}) => ({ key, name, emoji, price, cat, ...o });

export const PRESETS = {
  taqueria: {
    label: 'Taquería', emoji: '🌮',
    modules: { tables: false, kitchen: true, waiters: true, recipes: true },
    categories: [['tacos', 'Tacos', '🌮', '#f59e0b'], ['bebidas', 'Bebidas', '🥤', '#3b82f6'], ['insumos', 'Insumos', '📦', '#64748b']],
    products: [
      p('tortilla', 'Tortilla', '🫓', 0, 'insumos', { sellable: 0, track: 1, min: 100, stock: 500, cost: 0.4 }),
      p('pastor_kg', 'Carne al pastor', '🥩', 0, 'insumos', { sellable: 0, track: 1, unit: 'kg', min: 2, stock: 8, cost: 160 }),
      p('suadero_kg', 'Suadero', '🥩', 0, 'insumos', { sellable: 0, track: 1, unit: 'kg', min: 2, stock: 6, cost: 180 }),
      p('pastor', 'Taco al pastor', '🌮', 18, 'tacos', { station: 'cocina', recipe: [['tortilla', 2], ['pastor_kg', 0.035]] }),
      p('suadero', 'Taco de suadero', '🌮', 20, 'tacos', { station: 'cocina', recipe: [['tortilla', 2], ['suadero_kg', 0.035]] }),
      p('gringa', 'Gringa', '🫔', 45, 'tacos', { station: 'cocina', recipe: [['tortilla', 2], ['pastor_kg', 0.08]] }),
      p('quesadilla', 'Quesadilla', '🧀', 35, 'tacos', { station: 'cocina', recipe: [['tortilla', 1]] }),
      p('refresco', 'Refresco 600 ml', '🥤', 25, 'bebidas', { track: 1, min: 12, stock: 48, cost: 14 }),
      p('agua', 'Agua de horchata', '🥛', 25, 'bebidas'),
      p('cerveza', 'Cerveza', '🍺', 35, 'bebidas', { track: 1, min: 12, stock: 48, cost: 18 }),
    ],
    tables: 0,
  },
  restaurante: {
    label: 'Restaurante', emoji: '🍽️',
    modules: { tables: true, kitchen: true, waiters: true, recipes: true },
    categories: [['comida', 'Platillos', '🍛', '#ef4444'], ['desayunos', 'Desayunos', '🍳', '#f59e0b'], ['bebidas', 'Bebidas', '🥤', '#3b82f6']],
    products: [
      p('chilaquiles', 'Chilaquiles', '🍳', 95, 'desayunos', { station: 'cocina' }),
      p('molletes', 'Molletes', '🥖', 75, 'desayunos', { station: 'cocina' }),
      p('enchiladas', 'Enchiladas', '🌯', 120, 'comida', { station: 'cocina' }),
      p('hamburguesa', 'Hamburguesa', '🍔', 140, 'comida', { station: 'cocina' }),
      p('sopa', 'Sopa del día', '🍲', 60, 'comida', { station: 'cocina' }),
      p('ensalada', 'Ensalada', '🥗', 85, 'comida', { station: 'cocina' }),
      p('cafe', 'Café americano', '☕', 35, 'bebidas', { station: 'barra' }),
      p('jugo', 'Jugo natural', '🧃', 45, 'bebidas', { station: 'barra' }),
      p('refresco', 'Refresco', '🥤', 35, 'bebidas', { track: 1, min: 12, stock: 48, cost: 14 }),
      p('cerveza', 'Cerveza', '🍺', 55, 'bebidas', { track: 1, min: 12, stock: 48, cost: 18 }),
    ],
    tables: 10,
  },
  bar: {
    label: 'Bar / Cantina', emoji: '🍻',
    modules: { tables: true, kitchen: true, waiters: true, recipes: true },
    categories: [['cervezas', 'Cervezas', '🍺', '#f59e0b'], ['tragos', 'Tragos', '🍸', '#8b5cf6'], ['botanas', 'Botanas', '🍟', '#ef4444']],
    products: [
      p('cerveza', 'Cerveza', '🍺', 45, 'cervezas', { track: 1, min: 24, stock: 120, cost: 18 }),
      p('cubeta', 'Cubeta (6 cervezas)', '🪣', 240, 'cervezas', { recipe: [['cerveza', 6]] }),
      p('michelada', 'Michelada', '🍹', 75, 'cervezas', { station: 'barra', recipe: [['cerveza', 1]] }),
      p('tequila', 'Tequila (caballito)', '🥃', 70, 'tragos', { station: 'barra' }),
      p('mezcal', 'Mezcal', '🥃', 85, 'tragos', { station: 'barra' }),
      p('cuba', 'Cuba libre', '🍸', 90, 'tragos', { station: 'barra' }),
      p('papas', 'Papas a la francesa', '🍟', 80, 'botanas', { station: 'cocina' }),
      p('alitas', 'Alitas (10 pzas)', '🍗', 150, 'botanas', { station: 'cocina' }),
    ],
    tables: 12,
  },
  cafeteria: {
    label: 'Cafetería', emoji: '☕',
    modules: { tables: false, kitchen: true, waiters: false, recipes: true },
    categories: [['cafe', 'Café', '☕', '#92400e'], ['pan', 'Panadería', '🥐', '#f59e0b']],
    products: [
      p('leche', 'Leche', '🥛', 0, 'cafe', { sellable: 0, track: 1, unit: 'lt', min: 4, stock: 12, cost: 26 }),
      p('americano', 'Americano', '☕', 40, 'cafe', { station: 'barra' }),
      p('latte', 'Latte', '☕', 55, 'cafe', { station: 'barra', recipe: [['leche', 0.25]] }),
      p('capuchino', 'Capuchino', '☕', 55, 'cafe', { station: 'barra', recipe: [['leche', 0.2]] }),
      p('croissant', 'Croissant', '🥐', 38, 'pan', { track: 1, min: 5, stock: 20, cost: 15 }),
      p('galleta', 'Galleta', '🍪', 25, 'pan', { track: 1, min: 5, stock: 30, cost: 8 }),
    ],
    tables: 0,
  },
  abarrotes: {
    label: 'Abarrotes / Minisúper', emoji: '🛒',
    modules: { barcode: true },
    categories: [['bebidas', 'Bebidas', '🥤', '#3b82f6'], ['botanas', 'Botanas', '🍿', '#ef4444'], ['despensa', 'Despensa', '🥫', '#16a34a'], ['limpieza', 'Limpieza', '🧼', '#06b6d4']],
    products: [
      p('coca', 'Refresco cola 600 ml', '🥤', 22, 'bebidas', { track: 1, min: 12, stock: 48, cost: 15, barcode: '7501055300075' }),
      p('agua', 'Agua 1 L', '💧', 15, 'bebidas', { track: 1, min: 12, stock: 36, cost: 8 }),
      p('papas', 'Papas fritas', '🥔', 20, 'botanas', { track: 1, min: 10, stock: 30, cost: 13 }),
      p('galletas', 'Galletas', '🍪', 18, 'botanas', { track: 1, min: 10, stock: 30, cost: 11 }),
      p('leche', 'Leche 1 L', '🥛', 28, 'despensa', { track: 1, min: 6, stock: 24, cost: 22 }),
      p('huevo', 'Huevo (kg)', '🥚', 48, 'despensa', { track: 1, unit: 'kg', min: 3, stock: 15, cost: 38 }),
      p('pan', 'Pan de caja', '🍞', 45, 'despensa', { track: 1, min: 4, stock: 12, cost: 36 }),
      p('atun', 'Atún en lata', '🥫', 24, 'despensa', { track: 1, min: 6, stock: 24, cost: 17 }),
      p('jabon', 'Jabón de barra', '🧼', 22, 'limpieza', { track: 1, min: 6, stock: 18, cost: 14 }),
    ],
    tables: 0,
  },
  fruteria: {
    label: 'Frutería / Verdulería', emoji: '🥑',
    modules: { weight: true },
    categories: [['frutas', 'Frutas', '🍎', '#ef4444'], ['verduras', 'Verduras', '🥬', '#16a34a']],
    products: [
      p('jitomate', 'Jitomate', '🍅', 28, 'verduras', { unit: 'kg', track: 1, min: 5, stock: 40, cost: 18 }),
      p('cebolla', 'Cebolla', '🧅', 24, 'verduras', { unit: 'kg', track: 1, min: 5, stock: 30, cost: 15 }),
      p('papa', 'Papa', '🥔', 26, 'verduras', { unit: 'kg', track: 1, min: 5, stock: 30, cost: 16 }),
      p('aguacate', 'Aguacate', '🥑', 70, 'verduras', { unit: 'kg', track: 1, min: 3, stock: 20, cost: 50 }),
      p('limon', 'Limón', '🍋', 30, 'frutas', { unit: 'kg', track: 1, min: 5, stock: 25, cost: 18 }),
      p('platano', 'Plátano', '🍌', 22, 'frutas', { unit: 'kg', track: 1, min: 5, stock: 30, cost: 12 }),
      p('manzana', 'Manzana', '🍎', 45, 'frutas', { unit: 'kg', track: 1, min: 5, stock: 25, cost: 30 }),
      p('naranja', 'Naranja', '🍊', 20, 'frutas', { unit: 'kg', track: 1, min: 5, stock: 40, cost: 10 }),
    ],
    tables: 0,
  },
  mayoreo: {
    label: 'Mayoreo', emoji: '📦',
    modules: { barcode: true, wholesale: true },
    categories: [['bebidas', 'Bebidas', '🥤', '#3b82f6'], ['abarrotes', 'Abarrotes', '🌾', '#f59e0b']],
    products: [
      p('refresco_caja', 'Refresco 600 ml (caja 24)', '🥤', 380, 'bebidas', { track: 1, min: 10, stock: 60, cost: 300, pw: 350, wm: 5 }),
      p('agua_garrafon', 'Agua garrafón 20 L', '💧', 45, 'bebidas', { track: 1, min: 10, stock: 40, cost: 25, pw: 38, wm: 10 }),
      p('azucar', 'Azúcar (bulto 50 kg)', '🌾', 1250, 'abarrotes', { track: 1, min: 3, stock: 15, cost: 1050, pw: 1180, wm: 3 }),
      p('arroz', 'Arroz (bulto 25 kg)', '🍚', 720, 'abarrotes', { track: 1, min: 3, stock: 15, cost: 590, pw: 680, wm: 3 }),
      p('aceite', 'Aceite (caja 12 L)', '🫒', 560, 'abarrotes', { track: 1, min: 3, stock: 20, cost: 460, pw: 530, wm: 4 }),
    ],
    tables: 0,
  },
  papeleria: {
    label: 'Papelería', emoji: '✏️',
    modules: { barcode: true },
    categories: [['utiles', 'Útiles', '✏️', '#8b5cf6'], ['servicios', 'Servicios', '🖨️', '#0ea5e9']],
    products: [
      p('copia', 'Copia B/N', '📄', 1, 'servicios'),
      p('impresion', 'Impresión color', '🖨️', 5, 'servicios'),
      p('cuaderno', 'Cuaderno profesional', '📓', 45, 'utiles', { track: 1, min: 10, stock: 40, cost: 28 }),
      p('lapiz', 'Lápiz', '✏️', 6, 'utiles', { track: 1, min: 20, stock: 100, cost: 2.5 }),
      p('pluma', 'Pluma', '🖊️', 9, 'utiles', { track: 1, min: 20, stock: 100, cost: 4 }),
      p('goma', 'Goma', '🧽', 5, 'utiles', { track: 1, min: 10, stock: 50, cost: 2 }),
    ],
    tables: 0,
  },
  otro: {
    label: 'Otro negocio', emoji: '🏪',
    modules: {},
    categories: [['general', 'General', '🏷️', '#64748b']],
    products: [p('producto', 'Producto de ejemplo', '🏷️', 10, 'general', { track: 1, min: 5, stock: 20 })],
    tables: 0,
  },
};

export const DEFAULT_MODULES = { tables: false, kitchen: false, waiters: false, recipes: false, barcode: false, weight: false, wholesale: false };

// Construye todas las filas iniciales de un negocio nuevo. Se ejecuta en el dispositivo
// (también sin internet); después se suben a la nube con la sincronización normal.
export function buildSeed({ type, tenantId, businessName, ownerName, pin, timezone, deviceId }) {
  const preset = PRESETS[type] || PRESETS.otro;
  const now = Date.now();
  const base = () => ({ updated_at: now, deleted: 0 });
  const rows = {};
  const add = (t, r) => (rows[t] ||= []).push({ ...base(), ...r });

  const branchId = uid();
  add('config', {
    id: 'business',
    value: {
      name: businessName, type, currency: 'MXN', timezone: timezone || 'America/Mexico_City',
      modules: { ...DEFAULT_MODULES, ...preset.modules },
      waiters_can_charge: true, allow_negative_stock: true,
      report_hour: 8, progress_hours: [], ticket_footer: '¡Gracias por su compra!',
    },
  });
  add('branches', { id: branchId, name: 'Principal', address: '', active: 1 });
  add('users', { id: uid(), name: ownerName || 'Dueño', role: 'owner', pin_hash: pinHash(tenantId, pin || '1234'), color: '#2563eb', active: 1, branch_id: null });

  const cats = {};
  preset.categories.forEach(([key, name, emoji, color], i) => {
    cats[key] = uid();
    add('categories', { id: cats[key], name, emoji, color, sort: i, active: 1 });
  });
  const ids = {};
  preset.products.forEach((x) => { ids[x.key] = uid(); });
  preset.products.forEach((x, i) => {
    add('products', {
      id: ids[x.key], category_id: cats[x.cat] || null, name: x.name, price: x.price,
      price_wholesale: x.pw ?? null, wholesale_min: x.wm ?? null, cost: x.cost ?? 0,
      unit: x.unit || 'pza', barcode: x.barcode || '', image: '', emoji: x.emoji,
      station: x.station || '', track_stock: x.track ? 1 : 0, stock_min: x.min ?? 0,
      recipe: (x.recipe || []).map(([k, qty]) => ({ product_id: ids[k], qty })), sort: i,
      active: 1, sellable: x.sellable ?? 1,
    });
    if (x.track && x.stock) {
      add('stock_moves', {
        id: uid(), branch_id: branchId, product_id: ids[x.key], qty: x.stock, kind: 'count',
        ref_id: null, note: 'Inventario inicial', user_id: null, created_at: now, cost: x.cost ?? 0,
      });
    }
  });
  for (let i = 1; i <= (preset.tables || 0); i++) {
    add('tables', { id: uid(), branch_id: branchId, name: `Mesa ${i}`, zone: '', sort: i, active: 1 });
  }
  return { rows, branchId, deviceId };
}
