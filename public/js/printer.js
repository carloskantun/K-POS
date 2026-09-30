// Impresión de tickets y comandas.
//  - "system": diálogo de impresión del navegador (AirPrint en iPad/iPhone, cualquier impresora en PC).
//  - "bluetooth": impresora térmica BLE con ESC/POS (Chrome en Android, Windows, Mac; no iOS).
//  - "serial": impresora térmica USB/serial con ESC/POS (Chrome/Edge en computadora y Android con OTG).
import { S, on, get, list, cfg, setMeta } from './store.js';
import { orderTitle, liveItems, modsText } from './orders.js';
import { esc, money, qty, toast } from './ui.js';
import { PAY_METHODS } from './shared/schema.js';

export const printerCfg = () => ({ type: 'system', width: 58, auto_kitchen: false, stations: [], auto_receipt: false, ...(S.meta.device?.printer || {}) });
export const savePrinterCfg = (patch) => setMeta('device', { ...S.meta.device, printer: { ...printerCfg(), ...patch } });

export const support = {
  bluetooth: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  serial: typeof navigator !== 'undefined' && !!navigator.serial,
};

// ---------- Documento ----------
// Líneas: { t: texto, b: negrita, big: doble tamaño, c: centrado } | { hr: 1 } | { lr: [izq, der], b }

function cols(width) { return width >= 80 ? 48 : 32; }

function receiptDoc(o) {
  const c = cfg();
  const items = liveItems(o.id);
  const pays = list('payments', (p) => p.order_id === o.id);
  const tips = pays.reduce((t, p) => t + (Number(p.tip) || 0), 0);
  const L = [
    { t: c.name || '', b: 1, big: 1, c: 1 },
    ...(c.ticket_header ? String(c.ticket_header).split('\n').map((t) => ({ t, c: 1 })) : []),
    { t: new Date(o.closed_at || Date.now()).toLocaleString('es-MX'), c: 1 },
    { t: `${orderTitle(o)} · #${o.number}`, c: 1 },
    { hr: 1 },
  ];
  for (const i of items) {
    L.push({ lr: [`${qty(i.qty, i.unit)} ${i.name}`, money(i.total)] });
    if (i.mods?.length) L.push({ t: `  ${modsText(i.mods)}` });
  }
  L.push({ hr: 1 });
  if (o.discount) L.push({ lr: ['Descuento', `-${money(o.discount)}`] });
  L.push({ lr: ['TOTAL', money(o.total)], b: 1, big: 1 });
  for (const p of pays) {
    L.push({ lr: [PAY_METHODS[p.method] || p.method, money(p.received)] });
    if (p.change_given) L.push({ lr: ['Cambio', money(p.change_given)] });
  }
  if (tips) L.push({ lr: ['Propina', money(tips)] });
  if (!pays.length) L.push({ t: 'PRE-CUENTA · no es comprobante de pago', c: 1 });
  if (c.ticket_footer) L.push({ t: '' }, { t: c.ticket_footer, c: 1 });
  return L;
}

function kitchenDoc(o, items, station) {
  const u = get('users', o.user_id);
  const L = [
    { t: `${station ? station.toUpperCase() : 'COMANDA'}`, b: 1, c: 1 },
    { t: orderTitle(o), b: 1, big: 1, c: 1 },
    { t: `${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}${u ? ` · ${u.name}` : ''} · #${o.number}`, c: 1 },
    { hr: 1 },
  ];
  for (const i of items) {
    L.push({ t: `${qty(i.qty, i.unit)} x ${i.name}`, b: 1, big: 1 });
    if (i.mods?.length) L.push({ t: `   > ${modsText(i.mods)}`, b: 1 });
    if (i.note) L.push({ t: `   ** ${i.note}`, b: 1 });
  }
  L.push({ hr: 1 });
  return L;
}

// ---------- Salida HTML (impresión del sistema) ----------

function toHtml(doc, width) {
  const row = (l) => {
    if (l.hr) return '<hr>';
    const cls = [l.b && 'b', l.big && 'big', l.c && 'c'].filter(Boolean).join(' ');
    if (l.lr) return `<div class="r-row ${cls}"><span>${esc(l.lr[0])}</span><span>${esc(l.lr[1])}</span></div>`;
    return `<div class="${cls}">${esc(l.t) || '&nbsp;'}</div>`;
  };
  return `<div class="receipt w${width}">${doc.map(row).join('')}</div>`;
}

function systemPrint(docs, width) {
  let area = document.getElementById('print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.append(area); }
  area.innerHTML = docs.map((d) => toHtml(d, width)).join('<div class="page-break"></div>');
  window.print();
}

// ---------- ESC/POS ----------

const CP850 = { 'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ü': 0x81, 'Ü': 0x9a, 'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '¿': 0xa8, '¡': 0xad, '°': 0xf8 };

function encodeText(s) {
  const out = [];
  for (const ch of String(s)) {
    if (CP850[ch]) out.push(CP850[ch]);
    else {
      const code = ch.codePointAt(0);
      if (code < 128) out.push(code);
      else {
        const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (plain.length === 1 && plain.charCodeAt(0) < 128) out.push(plain.charCodeAt(0));
      }
    }
  }
  return out;
}

export function toEscPos(doc, width = 58) {
  const n = cols(width);
  const b = [0x1b, 0x40, 0x1b, 0x74, 0x02]; // inicializar + página de códigos PC850
  const fit = (s, w) => (s.length > w ? s.slice(0, w) : s);
  for (const l of doc) {
    if (l.hr) { b.push(...encodeText('-'.repeat(n)), 0x0a); continue; }
    b.push(0x1b, 0x61, l.c ? 1 : 0); // alineación
    b.push(0x1b, 0x45, l.b ? 1 : 0); // negrita
    b.push(0x1d, 0x21, l.big ? 0x11 : 0x00); // doble alto y ancho
    const w = l.big ? Math.floor(n / 2) : n;
    if (l.lr) {
      const right = String(l.lr[1]);
      const left = fit(String(l.lr[0]), w - right.length - 1);
      b.push(...encodeText(left + ' '.repeat(Math.max(1, w - left.length - right.length)) + right), 0x0a);
    } else {
      // Ajuste de línea por palabras.
      const words = String(l.t || '').split(' ');
      let line = '';
      for (const word of words) {
        if ((line + (line ? ' ' : '') + word).length > w && line) { b.push(...encodeText(line), 0x0a); line = word; }
        else line += (line ? ' ' : '') + word;
      }
      b.push(...encodeText(line), 0x0a);
    }
  }
  b.push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // avanzar y cortar
  return new Uint8Array(b);
}

// ---------- Conexiones ----------

const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb'];
let bleChar = null;
let serialPort = null;

async function bleCharacteristic(device) {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  for (const uuid of BLE_SERVICES) {
    try {
      const svc = await server.getPrimaryService(uuid);
      for (const ch of await svc.getCharacteristics()) {
        if (ch.properties.write || ch.properties.writeWithoutResponse) return ch;
      }
    } catch { /* siguiente servicio */ }
  }
  throw new Error('La impresora no expone un canal de escritura compatible');
}

export async function connect(type) {
  if (type === 'bluetooth') {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    bleChar = await bleCharacteristic(device);
    await savePrinterCfg({ type, device_name: device.name || 'Impresora Bluetooth' });
    return device.name;
  }
  if (type === 'serial') {
    serialPort = await navigator.serial.requestPort();
    await savePrinterCfg({ type, device_name: 'Impresora USB' });
    return 'USB';
  }
  await savePrinterCfg({ type });
  return 'Sistema';
}

async function reconnect(type) {
  if (type === 'bluetooth' && !bleChar) {
    const devs = (await navigator.bluetooth.getDevices?.()) || [];
    if (!devs.length) throw new Error('Vuelve a conectar la impresora en Ajustes → Dispositivos');
    bleChar = await bleCharacteristic(devs[0]);
  }
  if (type === 'serial' && !serialPort) {
    const ports = await navigator.serial.getPorts();
    if (!ports.length) throw new Error('Vuelve a conectar la impresora en Ajustes → Dispositivos');
    serialPort = ports[0];
  }
}

async function sendBytes(type, bytes) {
  await reconnect(type);
  if (type === 'bluetooth') {
    for (let i = 0; i < bytes.length; i += 180) {
      const chunk = bytes.slice(i, i + 180);
      if (bleChar.properties.writeWithoutResponse) await bleChar.writeValueWithoutResponse(chunk);
      else await bleChar.writeValue(chunk);
    }
  } else if (type === 'serial') {
    if (!serialPort.writable) await serialPort.open({ baudRate: 9600 });
    const w = serialPort.writable.getWriter();
    try { await w.write(bytes); } finally { w.releaseLock(); }
  }
}

async function output(docs) {
  const c = printerCfg();
  if (c.type === 'none') return;
  if (c.type === 'system' || !support[c.type]) return systemPrint(docs, c.width);
  try {
    for (const d of docs) await sendBytes(c.type, toEscPos(d, c.width));
  } catch (e) {
    bleChar = null;
    toast(`Impresora: ${e.message}`, 'error', 4000);
  }
}

export const printReceipt = (o) => output([receiptDoc(o)]);
export const printKitchen = (o, items, station) => output([kitchenDoc(o, items, station)]);
export const printTest = () => output([[{ t: cfg().name || 'K-POS', b: 1, big: 1, c: 1 }, { t: 'Prueba de impresión ñ á é í ó ú', c: 1 }, { hr: 1 }, { lr: ['Total', money(123.5)], b: 1 }]]);

// ---------- Comandas automáticas ----------
// El dispositivo que tiene la impresora (cocina, barra o la caja) imprime lo que llega para sus estaciones.

const PRINTED_KEY = 'kpos.printed';
let printed = new Set();
let started = 0;

export function startKitchenPrinting() {
  try { printed = new Set(JSON.parse(localStorage.getItem(PRINTED_KEY) || '[]')); } catch { printed = new Set(); }
  started = Date.now() - 60_000;
  let busy = false;
  const run = async () => {
    const c = printerCfg();
    if (!c.auto_kitchen || busy) return;
    const fresh = list('order_items', (i) => i.status === 'sent' && i.station && !printed.has(i.id.split('~')[0]) && (i.sent_at || 0) > started
      && (!c.stations.length || c.stations.includes(i.station)));
    if (!fresh.length) return;
    busy = true;
    try {
      const groups = new Map();
      for (const i of fresh) {
        const k = `${i.order_id}|${i.station}`;
        groups.set(k, [...(groups.get(k) || []), i]);
      }
      for (const [k, items] of groups) {
        const o = get('orders', k.split('|')[0]);
        if (o) await printKitchen(o, items, items[0].station);
        items.forEach((i) => printed.add(i.id.split('~')[0]));
      }
      localStorage.setItem(PRINTED_KEY, JSON.stringify([...printed].slice(-500)));
    } finally {
      busy = false;
    }
  };
  on((changed) => { if (changed.has('order_items')) run(); });
}
