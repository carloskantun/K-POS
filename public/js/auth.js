// Autorización de acciones sensibles con PIN de encargado + bitácora (tabla audit).
import { S, list, can, tenantId, branchId } from './store.js';
import { esc, openModal } from './ui.js';
import { ROLES } from './shared/schema.js';
import { pinHash, uid } from './shared/util.js';

export const ACTIONS = {
  cancel_item: 'Canceló producto',
  cancel_order: 'Canceló cuenta',
  discount: 'Descuento',
  cash_out: 'Salida de efectivo',
  reopen: 'Reabrió cuenta',
  stock_adjust: 'Ajuste de inventario',
};

// Si el usuario actual puede, regresa su id. Si no, pide el PIN de alguien con permiso.
export function authorize(label, perm = 'cancel') {
  if (can(perm)) return Promise.resolve(S.user.id);
  return new Promise((resolve) => {
    let pin = '';
    const managers = () => list('users', (u) => u.active !== 0 && (ROLES[u.role]?.perms || []).includes(perm));
    const draw = () => {
      m.setHtml(`<p class="lead center">${esc(label)}</p><p class="muted center">Pide a un encargado que escriba su PIN.</p>
        <div class="pin-dots">${[0, 1, 2, 3].map((i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('')}</div>
        <p class="error center" id="err"></p>
        <div class="np-keys pin">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) => (k ? `<button class="np-key" data-act="k" data-k="${k}">${k}</button>` : '<span></span>')).join('')}</div>`);
    };
    const m = openModal({
      title: '🔒 Autorización',
      size: 'small',
      onClick: (act, a) => {
        if (act !== 'k') return;
        const k = a.dataset.k;
        if (k === '⌫') pin = pin.slice(0, -1);
        else if (pin.length < 4) pin += k;
        draw();
        if (pin.length === 4) {
          const h = pinHash(tenantId(), pin);
          const who = managers().find((u) => u.pin_hash === h);
          if (who) return m.close(who.id);
          pin = '';
          draw();
          m.$('#err').textContent = 'PIN sin permiso para esta acción';
        }
      },
      onClose: (r) => resolve(r ?? null),
      html: '',
    });
    draw();
  });
}

export function auditRow(action, { ref = null, amount = null, detail = '', by = null } = {}) {
  return ['audit', {
    id: uid(), branch_id: branchId(), user_id: S.user?.id || null, authorized_by: by || S.user?.id || null,
    action, ref_id: ref, detail: String(detail || '').slice(0, 300), amount, created_at: Date.now(),
  }];
}
