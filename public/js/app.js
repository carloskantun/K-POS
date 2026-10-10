import { S, init, on, can, mod, cfg, login, get } from './store.js';
import { startSync, syncNow } from './sync.js';
import { startKitchenPrinting } from './printer.js';
import { esc, avatar, toast, openModal, icon } from './ui.js';
import * as setup from './views/setup.js';
import * as lock from './views/login.js';
import * as pos from './views/pos.js';
import * as tables from './views/tables.js';
import * as kitchen from './views/kitchen.js';
import * as inventory from './views/inventory.js';
import * as cash from './views/cash.js';
import * as results from './views/results.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';

const VIEWS = { pos, tables, kitchen, inventory, cash, results, reports, settings };

const NAV = [
  { id: 'pos', label: 'Vender', icon: '🛒', perm: 'pos' },
  { id: 'tables', label: 'Mesas', icon: '🍽️', perm: 'tables', module: 'tables' },
  { id: 'kitchen', label: 'Comandas', icon: '👨‍🍳', perm: 'kitchen', module: 'kitchen' },
  { id: 'inventory', label: 'Inventario', icon: '📦', perm: 'inventory' },
  { id: 'cash', label: 'Caja', icon: '🏦', perm: 'cash' },
  { id: 'results', label: 'Resultados', icon: '📈', perm: 'reports' },
  { id: 'reports', label: 'Reportes', icon: '📊', perm: 'reports' },
  { id: 'settings', label: 'Ajustes', icon: '⚙️', perm: 'settings' },
];

const app = document.getElementById('app');
let unmount = null;
let current = null;

const visibleNav = () => NAV.filter((n) => can(n.perm) && (!n.module || mod(n.module)));

function defaultRoute() {
  if (S.meta.device?.mode === 'kitchen' && can('kitchen')) return 'kitchen';
  const nav = visibleNav();
  if (S.user?.role === 'mesero' && mod('tables')) return 'tables';
  return nav[0]?.id || 'pos';
}

export function go(route, params = {}) {
  const q = new URLSearchParams(params).toString();
  const hash = `#/${route}${q ? `?${q}` : ''}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const [path, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { route: path || '', params: Object.fromEntries(new URLSearchParams(q || '')) };
}

function statusPill() {
  if (S.meta.demo) return '<span class="pill gray" title="Los datos viven solo en este dispositivo">●<span class="pt"> Modo local</span></span>';
  if (S.syncError) return `<span class="pill red">●<span class="pt"> ${esc(S.syncError)}</span></span>`;
  if (!S.online || !navigator.onLine) return `<span class="pill amber" title="Sigue vendiendo: todo se guarda en el dispositivo">●<span class="pt"> Sin conexión</span>${S.pending ? ` · ${S.pending}` : ''}</span>`;
  if (S.pending) return `<span class="pill amber">●<span class="pt"> Subiendo</span> ${S.pending}</span>`;
  return '<span class="pill green">●<span class="pt"> En línea</span></span>';
}

function renderHeader() {
  const h = document.getElementById('topbar');
  if (!h) return;
  const branch = get('branches', S.meta.branch_id);
  h.innerHTML = `
    <div class="brand"><span class="logo">K</span><div><b>${esc(cfg().name || S.meta.tenant?.name || 'K-POS')}</b>${branch && branchCount() > 1 ? `<small>${esc(branch.name)}</small>` : ''}</div></div>
    <div class="top-actions">
      <button class="pill-btn" data-act="sync">${statusPill()}</button>
      <button class="user-btn" data-act="lock" title="Usuario y salida" aria-label="Abrir menú de usuario">${avatar(S.user)}<span>${esc(S.user?.name || '')}</span></button>
    </div>`;
}

const branchCount = () => [...S.data.branches.values()].filter((b) => !b.deleted).length;

function renderNav(active) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const items = visibleNav();
  const primary = items.length <= 5 ? items : items.filter(n => ['pos','tables','kitchen','cash'].includes(n.id));
  for (const n of items) if (primary.length < 4 && !primary.includes(n)) primary.push(n);
  const secondary = items.filter(n => !primary.includes(n));
  nav.innerHTML = items.map((n) => `<a href="#/${n.id}" class="${n.id === active ? 'active' : ''} ${secondary.includes(n) ? 'nav-secondary' : ''}"><span class="ni">${icon(n.id)}</span><span class="nl">${n.label}</span>${n.id === 'kitchen' ? '<i class="badge" id="kds-badge"></i>' : ''}${n.id === 'tables' || (n.id === 'pos' && !mod('tables')) ? '<i class="badge green" id="ready-badge"></i>' : ''}</a>`).join('');
  if (secondary.length) {
    nav.insertAdjacentHTML('beforeend', `<button class="nav-more ${secondary.some(n => n.id === active) ? 'active' : ''}" aria-label="Más opciones de navegación">${icon('more')}<span>Más</span></button>`);
    nav.querySelector('.nav-more').onclick = () => {
      const m = openModal({ title: 'Más opciones', size: 'small', html: `<div class="menu-list">${secondary.map(n => `<button data-act="route" data-route="${n.id}">${esc(n.label)}</button>`).join('')}</div>`, onClick: (act,a) => { if (act === 'route') { m.close(); go(a.dataset.route); } } });
    };
  }
  nav.classList.toggle('single' , items.length <= 1);
  updateBadges();
}

function updateBadges() {
  const k = document.getElementById('kds-badge');
  const r = document.getElementById('ready-badge');
  if (k) {
    const n = [...S.data.order_items.values()].filter((i) => !i.deleted && i.status === 'sent').length;
    k.textContent = n || '';
  }
  if (r) {
    const mine = S.user?.role === 'mesero';
    const n = [...S.data.order_items.values()].filter((i) => !i.deleted && i.status === 'ready' && (!mine || get('orders', i.order_id)?.user_id === S.user.id)).length;
    r.textContent = n || '';
  }
}

function render() {
  if (unmount) { unmount(); unmount = null; }
  if (!S.meta.device) {
    app.className = 'fullscreen';
    unmount = setup.mount(app, { onDone: boot });
    return;
  }
  if (!S.user || !S.user.active || S.user.deleted) {
    app.className = 'fullscreen';
    unmount = lock.mount(app, { onLogin: async (u) => { await login(u); go(defaultRoute()); render(); } });
    return;
  }
  let { route, params } = parseHash();
  const allowed = visibleNav().map((n) => n.id);
  if (!VIEWS[route] || !allowed.includes(route)) {
    route = defaultRoute();
    history.replaceState(null, '', `#/${route}`);
  }
  current = route;
  app.className = `shell view-${route}`;
  app.innerHTML = '<header id="topbar"></header><nav id="nav"></nav><main id="view"></main>';
  renderHeader();
  renderNav(route);
  unmount = VIEWS[route].mount(document.getElementById('view'), params, { go });
}

app.addEventListener('click', async (e) => {
  const a = e.target.closest('#topbar [data-act]');
  if (!a) return;
  if (a.dataset.act === 'lock') {
    const m = openModal({
      title: S.user?.name || 'Usuario', size: 'small',
      html: `<p class="muted">Salir bloquea este dispositivo y conserva las cuentas y ventas. Los otros dispositivos continúan trabajando.</p><p class="muted">${S.meta.demo ? 'Modo local: este negocio aún no sincroniza con otros dispositivos.' : 'Puedes consultar y revocar dispositivos en Ajustes → Dispositivos.'}</p><div class="menu-list">${can('settings') ? '<button data-act="devices">Ver dispositivos y conexión</button>' : ''}<button data-act="exit-user">Cambiar de usuario</button><button data-act="exit-user">Cerrar sesión en este dispositivo</button>${S.user?.role === 'owner' ? '<button data-act="platform-admin">Panel de superadministrador</button>' : ''}</div>`,
      onClick: async (act) => {
        if (act === 'exit-user') { m.close(); await login(null); render(); }
        else if (act === 'devices') { m.close(); go('settings', { s: 'device' }); }
        else if (act === 'platform-admin') { m.close(); await login(null); location.href = '/admin.html'; }
      },
    });
  } else if (a.dataset.act === 'sync') {
    if (S.meta.demo) toast('Modo local: conecta el negocio a la nube en Ajustes → Nube para usar varios dispositivos.', 'info', 4000);
    else { syncNow(); toast('Sincronizando…', 'info'); }
  }
});

on((changed) => {
  if (changed.has('_sync') || changed.size) renderHeader();
  if (changed.has('order_items') || changed.has('orders')) updateBadges();
  if (changed.has('config') && current) { if (!visibleNav().some(n=>n.id===current)) { go(defaultRoute()); } else renderNav(current); }
  if (changed.has('users') && S.user) {
    const u = get('users', S.user.id);
    if (!u || u.deleted || !u.active) { login(null).then(render); return; }
    S.user = u;
  }
});

window.addEventListener('hashchange', render);

let syncStarted = false;
async function boot() {
  await init();
  if (S.meta.device && !syncStarted) {
    syncStarted = true;
    if (!S.meta.demo) startSync();
    startKitchenPrinting();
  }
  render();
}
export { boot };

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Nueva versión disponible: se aplicará al recargar.', 'info', 5000);
        }
      });
    });
  }).catch(() => {});
}

boot().catch((e) => {
  console.error(e);
  app.innerHTML = `<div class="fatal"><h2>No se pudo iniciar</h2><p>${esc(e.message)}</p></div>`;
});
