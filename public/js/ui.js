// Componentes de interfaz reutilizables (sin framework).
import { fmtMoney, fmtQty } from './shared/util.js';
import { currency } from './store.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n) => fmtMoney(n, currency());
export const qty = fmtQty;

const ICON_PATHS = {
  pos: '<path d="m3 3 2 2 3 12h10l3-10H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>',
  tables: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M8 1v3m8-3v3M8 20v3m8-3v3M1 8h3m-3 8h3m16-8h3m-3 8h3"/>',
  kitchen: '<path d="M7 15H5a4 4 0 0 1 0-8 5 5 0 0 1 10 0 4 4 0 1 1 4 8h-2v6H7zM7 17h10"/>',
  inventory: '<path d="m12 3 9 5-9 5-9-5zM3 8v9l9 5 9-5V8M12 13v9M7 5l9 5"/>',
  cash: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M6 12h.1M18 12h.1"/>',
  reports: '<path d="M4 3v18h17M8 16v-5m5 5V6m5 10v-8"/>',
  settings: '<path d="m9 3 1-2h4l1 2 3 2 2 1v4l-2 1v3l2 1v4l-2 1-3 2-1 2h-4l-1-2-3-2-2-1v-4l2-1v-3-1l-2-1V6l2-1z" transform="translate(0 0) scale(.9)"/><circle cx="11" cy="11" r="3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.more}</svg>`;
}

export function visual(p, cls = '') {
  if (p?.image) return `<img class="pic ${cls}" src="${esc(p.image)}" alt="${esc(p.name || 'Producto')}" loading="lazy">`;
  const art = productArt(p?.name);
  if (art) return `<img class="pic ${cls}" src="/icons/products/${art}.svg" alt="Ilustración de referencia: ${esc(p?.name || 'Producto')}" loading="lazy">`;
  return `<span class="pic emoji ${cls}">${esc(p?.emoji || '🏷️')}</span>`;
}

function productArt(name = '') {
  const n = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/camarock|camarr|camaron/.test(n)) return 'shrimp';
  if (/gajos de cebolla/.test(n)) return 'rings';
  if (/burro|burrito/.test(n)) return 'burrito';
  if (/salchirock|banderilla/.test(n)) return 'hotdog';
  if (/kids alone/.test(n)) return 'wings';
  if (/salsa|aderezo|catsup|nopal|cebollin/.test(n)) return 'sauce';
  if (/alitas|boneless|nuggets|tiras de pollo|bucket/.test(n)) return 'wings';
  if (/papas|gajos/.test(n)) return 'fries';
  if (/cerveza|caguama|corona|victoria|indio|cubeta|cheladita|chela|rolling stone|la del barrio/.test(n)) return 'beer';
  if (/taco|taquito/.test(n)) return 'taco';
  if (/refresco|cola|agua/.test(n)) return 'soda';
  if (/monday|tekillers|charro|johnny|rata|vodka|pituf|mojito|margarita|tequila|whisky|mezcal/.test(n)) return 'cocktail';
  if (/torta|burro|hamburguesa|compartas|salchirock|camarock/.test(n)) return 'plate';
  return null;
}

export function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function avatar(u, cls = '') {
  return `<span class="avatar ${cls}" style="background:${esc(u?.color || '#64748b')}">${esc(initials(u?.name))}</span>`;
}

export function minutesAgo(ts) {
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

export function timeHM(ts) {
  return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

let toastEl = null;
export function toast(msg, type = 'ok', ms = 2200) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toasts';
    document.body.append(toastEl);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastEl.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

let modalNumber = 0;
// Modal genérico. onClick(act, el, api) recibe los clics en [data-act].
export function openModal({ title, html, size = '', onClick, onInput, onClose }) {
  const previousFocus = document.activeElement;
  const titleId = `modal-title-${++modalNumber}`;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
    <header><h2 id="${titleId}">${esc(title)}</h2><button class="icon-btn" data-act="close" aria-label="Cerrar">✕</button></header>
    <div class="modal-body"></div></div>`;
  const body = back.querySelector('.modal-body');
  body.innerHTML = html;
  document.body.append(back);
  let closed = false;
  const api = {
    el: back,
    body,
    close(result) {
      if (closed) return;
      closed = true;
      back.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      onClose?.(result);
    },
    setHtml(h) { body.innerHTML = h; },
    $: (sel) => back.querySelector(sel),
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) return api.close();
    const a = e.target.closest('[data-act]');
    if (!a || a.disabled) return;
    if (a.dataset.act === 'close') return api.close();
    onClick?.(a.dataset.act, a, api);
  });
  if (onInput) back.addEventListener('input', (e) => onInput(e.target, api));
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
    if (e.key === 'Tab') {
      const controls = [...back.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); back.querySelector('.modal').focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  setTimeout(() => (back.querySelector('[autofocus]') || back.querySelector('.modal')).focus(), 30);
  return api;
}

export function confirmBox(message, { ok = 'Aceptar', danger = false, title = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size: 'small',
      html: `<p class="lead">${esc(message)}</p><div class="actions"><button class="btn" data-act="no">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="yes">${esc(ok)}</button></div>`,
      onClick: (act) => m.close(act === 'yes'),
      onClose: (r) => resolve(!!r),
    });
  });
}

export function promptBox(title, { value = '', placeholder = '', label = '', type = 'text', ok = 'Guardar' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      size: 'small',
      html: `<form class="form">${label ? `<label>${esc(label)}</label>` : ''}<input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>
        <div class="actions"><button type="button" class="btn" data-act="close">Cancelar</button><button class="btn primary">${esc(ok)}</button></div></form>`,
      onClose: (r) => resolve(r ?? null),
    });
    m.$('form').onsubmit = (e) => {
      e.preventDefault();
      m.close(m.$('input').value.trim());
    };
  });
}

// Teclado numérico grande (kilos, efectivo, conteos). Devuelve número o null.
export function numpad(title, { value = '', unit = '', decimals = true, hint = '', quick = [] } = {}) {
  return new Promise((resolve) => {
    let v = value === '' || value == null ? '' : String(value);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? '.' : '', '0', '⌫'];
    const m = openModal({
      title,
      size: 'small',
      html: `<div class="numpad">
        ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
        <div class="np-display"><span class="np-val">${esc(v || '0')}</span> <small>${esc(unit)}</small></div>
        ${quick.length ? `<div class="np-quick">${quick.map((q) => `<button class="btn" data-act="q" data-v="${q.value}">${esc(q.label)}</button>`).join('')}</div>` : ''}
        <div class="np-keys">${keys.map((k) => (k ? `<button class="np-key" data-act="k" data-k="${k}">${k}</button>` : '<span></span>')).join('')}</div>
        <div class="actions"><button class="btn" data-act="close">Cancelar</button><button class="btn primary big" data-act="ok">Aceptar</button></div></div>`,
      onClick: (act, el) => {
        if (act === 'k') {
          const k = el.dataset.k;
          if (k === '⌫') v = v.slice(0, -1);
          else if (k === '.' && v.includes('.')) return;
          else if (v.length < 10) v = v === '0' && k !== '.' ? k : v + k;
        } else if (act === 'q') {
          v = el.dataset.v;
        } else if (act === 'ok') {
          const n = parseFloat(v);
          return m.close(Number.isFinite(n) ? n : null);
        }
        m.$('.np-val').textContent = v || '0';
      },
      onClose: (r) => resolve(r ?? null),
    });
    const onKey = (e) => {
      if (!document.body.contains(m.el)) return document.removeEventListener('keydown', onKey);
      if (/^[0-9.]$/.test(e.key)) m.$(`[data-k="${e.key}"]`)?.click();
      else if (e.key === 'Backspace') m.$('[data-k="⌫"]')?.click();
      else if (e.key === 'Enter') m.$('[data-act="ok"]')?.click();
    };
    document.addEventListener('keydown', onKey);
  });
}

let audio = null;
export function beep(times = 2) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(audio.destination);
      const t = audio.currentTime + i * 0.25;
      o.start(t);
      o.stop(t + 0.15);
    }
  } catch { /* sin audio */ }
}

// Redimensiona una foto a JPEG cuadrado pequeño (se guarda en el producto y se sincroniza).
export function imageToDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
