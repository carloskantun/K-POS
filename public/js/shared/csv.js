// CSV compatible con Excel (UTF-8 con BOM; lee comas o punto y coma).

export function toCSV(rows, headers) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(cell).join(',')];
  for (const r of rows) lines.push(headers.map((h) => cell(r[h])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return [];
  const norm = (h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const head = clean[0].map(norm);
  return clean.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export function download(filename, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const yes = (v) => /^(1|si|sí|s|yes|y|true|x)$/i.test(String(v || '').trim());
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[$\s]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export const PRODUCT_COLUMNS = ['nombre', 'categoria', 'precio', 'costo', 'unidad', 'codigo_barras', 'emoji', 'estacion', 'inventario', 'stock_minimo', 'existencia', 'en_venta', 'precio_mayoreo', 'mayoreo_desde'];

// Convierte una fila del CSV al formato de producto (sin id). Devuelve null si no tiene nombre.
export function productFromRow(r) {
  const name = r.nombre || r.producto || r.name;
  if (!name) return null;
  return {
    name,
    category: r.categoria || r.category || '',
    price: num(r.precio ?? r.price) ?? 0,
    cost: num(r.costo ?? r.cost) ?? 0,
    unit: (r.unidad || 'pza').toLowerCase(),
    barcode: r.codigo_barras || r.codigo || r.barcode || '',
    emoji: r.emoji || '',
    station: (r.estacion || '').toLowerCase(),
    track_stock: r.inventario != null && r.inventario !== '' ? (yes(r.inventario) ? 1 : 0) : (num(r.existencia) != null ? 1 : 0),
    stock_min: num(r.stock_minimo) ?? 0,
    stock: num(r.existencia),
    sellable: r.en_venta == null || r.en_venta === '' ? 1 : (yes(r.en_venta) ? 1 : 0),
    price_wholesale: num(r.precio_mayoreo),
    wholesale_min: num(r.mayoreo_desde),
  };
}
