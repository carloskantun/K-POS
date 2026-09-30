// Esquema de tablas sincronizadas. Lo usan la PWA (IndexedDB) y el Worker (D1).
// Todas las tablas tienen además: id, updated_at, deleted, (seq y tenant_id solo en servidor).

export const TABLES = {
  config: ['value'],
  branches: ['name', 'address', 'active'],
  users: ['name', 'role', 'pin_hash', 'color', 'active', 'branch_id'],
  categories: ['name', 'color', 'emoji', 'sort', 'active'],
  products: [
    'category_id', 'name', 'price', 'price_wholesale', 'wholesale_min', 'cost', 'unit',
    'barcode', 'image', 'emoji', 'station', 'track_stock', 'stock_min', 'recipe', 'sort',
    'active', 'sellable', 'modifiers',
  ],
  tables: ['branch_id', 'name', 'zone', 'sort', 'active'],
  orders: [
    'branch_id', 'number', 'table_id', 'user_id', 'customer', 'status', 'kind', 'subtotal',
    'discount', 'total', 'opened_at', 'closed_at', 'cash_session_id', 'device_id', 'note',
  ],
  order_items: [
    'order_id', 'branch_id', 'product_id', 'name', 'qty', 'unit', 'price', 'total', 'note',
    'station', 'status', 'sent_at', 'ready_at', 'user_id', 'cancel_reason', 'mods',
  ],
  payments: [
    'order_id', 'branch_id', 'method', 'amount', 'received', 'change_given', 'cash_session_id',
    'user_id', 'created_at', 'tip',
  ],
  stock_moves: [
    'branch_id', 'product_id', 'qty', 'kind', 'ref_id', 'note', 'user_id', 'created_at', 'cost',
  ],
  cash_sessions: [
    'branch_id', 'opened_by', 'opened_at', 'opening_amount', 'closed_by', 'closed_at',
    'counted_cash', 'expected_cash', 'status', 'note', 'summary',
  ],
  cash_moves: ['cash_session_id', 'branch_id', 'kind', 'amount', 'reason', 'user_id', 'created_at'],
  // Bitácora de acciones sensibles (cancelaciones, descuentos, reaperturas) con quién autorizó.
  audit: ['branch_id', 'user_id', 'authorized_by', 'action', 'ref_id', 'detail', 'amount', 'created_at'],
};

export const TABLE_NAMES = Object.keys(TABLES);

// Columnas guardadas como texto JSON en D1 y como objetos en el cliente.
export const JSON_FIELDS = {
  config: ['value'],
  products: ['recipe', 'modifiers'],
  order_items: ['mods'],
  cash_sessions: ['summary'],
};

// Tablas de solo inserción: un registro nunca cambia después de creado.
export const INSERT_ONLY = ['stock_moves', 'payments', 'cash_moves', 'audit'];

// Tablas operativas: en la primera sincronización solo se bajan los últimos días.
export const OPERATIONAL = ['orders', 'order_items', 'payments', 'stock_moves', 'cash_moves', 'audit'];
export const INITIAL_WINDOW_MS = 3 * 24 * 3600 * 1000;

// Orden de estados: nunca se permite regresar a un estado anterior.
export const ORDER_STATUS = ['open', 'paid', 'cancelled'];
export const ITEM_STATUS = ['new', 'sent', 'ready', 'served', 'cancelled'];

export const ROLES = {
  owner: { label: 'Dueño', perms: ['pos', 'tables', 'kitchen', 'inventory', 'cash', 'reports', 'settings', 'charge', 'cancel'] },
  admin: { label: 'Encargado', perms: ['pos', 'tables', 'kitchen', 'inventory', 'cash', 'reports', 'settings', 'charge', 'cancel'] },
  cajero: { label: 'Cajero', perms: ['pos', 'tables', 'kitchen', 'inventory', 'cash', 'reports', 'charge'] },
  mesero: { label: 'Mesero', perms: ['pos', 'tables', 'kitchen'] },
  cocina: { label: 'Cocina / Barra', perms: ['kitchen'] },
};

export const PAY_METHODS = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
};
