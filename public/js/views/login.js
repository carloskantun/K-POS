// Pantalla de bloqueo: cada persona entra con su PIN (funciona sin internet).
import { S, sorted, tenantId, cfg, accounts, activeDb, switchAccount } from '../store.js';
import { esc, avatar } from '../ui.js';
import { ROLES } from '../shared/schema.js';
import { pinHash } from '../shared/util.js';

export function mount(el, { onLogin }) {
  let selected = null;
  let pin = '';

  const users = () => sorted('users', (u) => u.active !== 0 && (!u.branch_id || u.branch_id === S.meta.branch_id));

  function draw() {
    const us = users();
    if (!selected) {
      el.innerHTML = `<div class="lock">
        <h1>${esc(cfg().name || S.meta.tenant?.name || 'K-POS')}</h1><p class="muted">¿Quién eres?</p>
        <div class="user-grid">${us.map((u) => `<button class="user-tile" data-act="user" data-id="${u.id}">${avatar(u, 'xl')}<b>${esc(u.name)}</b><small>${esc(ROLES[u.role]?.label || u.role)}</small></button>`).join('')}</div>
        ${us.length ? '' : '<p class="muted">Descargando usuarios… verifica tu conexión.</p>'}
        ${accounts().length > 1 ? `<div class="accounts">${accounts().filter((a) => a.db !== activeDb()).map((a) => `<button class="btn ghost" data-act="switch" data-db="${esc(a.db)}">↔ ${esc(a.name)}</button>`).join('')}</div>` : ''}
      </div>`;
      return;
    }
    el.innerHTML = `<div class="lock">
      ${avatar(selected, 'xl')}<h2>${esc(selected.name)}</h2>
      <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
      <p class="error" id="err"></p>
      <div class="np-keys pin">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', '⌫'].map((k) => `<button class="np-key" data-act="key" data-k="${k}">${k}</button>`).join('')}</div>
    </div>`;
  }

  function press(k) {
    if (k === '←') { selected = null; pin = ''; return draw(); }
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    draw();
    if (pin.length === 4) {
      if (pinHash(tenantId(), pin) === selected.pin_hash) {
        onLogin(selected);
      } else {
        pin = '';
        draw();
        el.querySelector('#err').textContent = 'PIN incorrecto';
        el.querySelector('.pin-dots')?.classList.add('shake');
      }
    }
  }

  const onClick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'user') { selected = S.data.users.get(a.dataset.id); pin = ''; draw(); }
    if (a.dataset.act === 'key') press(a.dataset.k);
    if (a.dataset.act === 'switch') switchAccount(a.dataset.db);
  };
  const onKey = (e) => {
    if (!selected) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('⌫');
    else if (e.key === 'Escape') press('←');
  };
  el.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  const off = setInterval(() => { if (!selected) draw(); }, 3000);
  draw();
  return () => {
    el.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    clearInterval(off);
  };
}
