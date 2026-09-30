// Alta de negocio / vinculación de dispositivo.
import { save, setMeta, login, list, accounts, activeDb, switchAccount } from '../store.js';
import { api, syncNow } from '../sync.js';
import { esc, toast, promptBox } from '../ui.js';
import { PRESETS, buildSeed } from '../shared/presets.js';
import { uid } from '../shared/util.js';

const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'Tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'Celular';
  return 'Computadora';
}

export function mount(el, { onDone }) {
  let step = 'welcome';
  let type = null;
  let hostSlug = null;

  api('/api/whoami', { auth: false }).then((r) => {
    if (r.slug) {
      hostSlug = r.slug;
      if (step === 'welcome') draw();
    }
  }).catch(() => {});

  const others = () => accounts().filter((a) => a.db !== activeDb());

  function draw() {
    if (step === 'welcome') {
      el.innerHTML = `<div class="setup">
        <div class="setup-hero"><span class="logo xl">K</span><h1>K-POS</h1><p>Punto de venta para tu negocio. Funciona en celular, tablet o computadora, con o sin internet.</p></div>
        <div class="setup-choices">
          <button class="choice" data-act="create"><span>🏪</span><b>Crear mi negocio</b><small>Elige tu giro y empieza a vender en 1 minuto</small></button>
          <button class="choice" data-act="link"><span>📲</span><b>Conectar este dispositivo</b><small>${hostSlug ? `Unirse a <b>${esc(hostSlug)}</b> con un código` : 'Unirse a un negocio que ya existe (mesero, cocina, otra caja)'}</small></button>
        </div>
        ${others().length ? `<div class="panel"><h3>Negocios en este dispositivo</h3><div class="menu-list">${others().map((a) => `<button data-act="switch" data-db="${esc(a.db)}">🏪 ${esc(a.name)}</button>`).join('')}</div></div>` : ''}
        </div>`;
    } else if (step === 'type') {
      el.innerHTML = `<div class="setup"><h2>¿Qué tipo de negocio tienes?</h2><p class="muted">Se activan las funciones que usas y se carga un catálogo de ejemplo que puedes editar.</p>
        <div class="type-grid">${Object.entries(PRESETS).map(([k, p]) => `<button class="type-card" data-act="type" data-type="${k}"><span>${p.emoji}</span><b>${esc(p.label)}</b></button>`).join('')}</div>
        <button class="btn ghost" data-act="back">← Regresar</button></div>`;
    } else if (step === 'create') {
      const p = PRESETS[type];
      el.innerHTML = `<div class="setup narrow"><h2>${p.emoji} ${esc(p.label)}</h2>
        <form class="form" id="f">
          <label>Nombre del negocio</label><input name="name" required placeholder="Ej. Taquería Lupita" autofocus>
          <label>Tu nombre</label><input name="owner" required placeholder="Ej. Lupita">
          <label>PIN de 4 dígitos (para entrar rápido)</label><input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required placeholder="1234">
          <label class="check"><input type="checkbox" name="cloud" checked> Crear cuenta en la nube <small>(varios dispositivos, respaldo y reportes por Telegram)</small></label>
          <div id="cloud">
            <label>Nombre de tu cuenta (subdominio)</label><div class="slug"><input name="slug" pattern="[a-z0-9\\-]{3,30}" placeholder="taqueria-lupita"><span>.${esc(location.hostname.split('.').slice(-2).join('.'))}</span></div>
            <label>Correo</label><input name="email" type="email" placeholder="tu@correo.com">
            <label>Contraseña</label><input name="password" type="password" minlength="6" placeholder="Mínimo 6 caracteres">
          </div>
          <p class="error" id="err"></p>
          <div class="actions"><button type="button" class="btn" data-act="back">← Regresar</button><button class="btn primary big" id="go">Crear negocio</button></div>
        </form></div>`;
      const f = el.querySelector('#f');
      let slugTouched = false;
      f.name.oninput = () => { if (!slugTouched) f.slug.value = slugify(f.name.value); };
      f.slug.oninput = () => { slugTouched = true; f.slug.value = slugify(f.slug.value); };
      // Los campos de la nube se desactivan (no solo se ocultan) para que no bloqueen el formulario.
      const syncCloud = () => {
        const box = el.querySelector('#cloud');
        box.hidden = !f.cloud.checked;
        box.querySelectorAll('input').forEach((i) => { i.disabled = !f.cloud.checked; });
      };
      f.cloud.onchange = syncCloud;
      if (!navigator.onLine) f.cloud.checked = false;
      syncCloud();
      f.onsubmit = (e) => { e.preventDefault(); create(f); };
    } else if (step === 'link') {
      el.innerHTML = `<div class="setup narrow"><h2>📲 Conectar dispositivo</h2>
        <p class="muted">En el dispositivo del dueño ve a <b>Ajustes → Dispositivos</b> y genera un código.</p>
        <form class="form" id="f">
          <label>Cuenta del negocio</label><input name="slug" required value="${esc(hostSlug || '')}" placeholder="taqueria-lupita">
          <label>Nombre de este dispositivo</label><input name="device" required value="${esc(guessDevice())}">
          <div id="by-code"><label>Código de 6 dígitos</label><input name="code" inputmode="numeric" maxlength="6" placeholder="123456" autofocus></div>
          <div id="by-pass" hidden><label>Correo del dueño</label><input name="email" type="email"><label>Contraseña</label><input name="password" type="password">
            <button type="button" class="btn ghost small" data-act="forgot">¿Olvidaste tu contraseña?</button></div>
          <button type="button" class="btn ghost small" data-act="toggle-pass">Usar correo y contraseña del dueño</button>
          <p class="error" id="err"></p>
          <div class="actions"><button type="button" class="btn" data-act="back">← Regresar</button><button class="btn primary big" id="go">Conectar</button></div>
        </form></div>`;
      const f = el.querySelector('#f');
      f.onsubmit = (e) => { e.preventDefault(); link(f); };
    }
  }

  const setErr = (m) => { const e = el.querySelector('#err'); if (e) e.textContent = m || ''; };
  const busy = (b) => {
    const g = el.querySelector('#go');
    if (!g) return;
    g.dataset.label ||= g.textContent;
    g.disabled = b;
    g.textContent = b ? 'Un momento…' : g.dataset.label;
  };

  async function create(f) {
    setErr('');
    const cloud = f.cloud.checked;
    const pin = f.pin.value.trim();
    if (!/^\d{4}$/.test(pin)) return setErr('El PIN debe tener 4 dígitos.');
    const tenantId = uid();
    const deviceName = guessDevice();
    let device = { id: uid(), name: deviceName, token: null, mode: 'pos' };
    let tenant = { id: tenantId, slug: null, name: f.name.value.trim() };
    busy(true);
    try {
      if (cloud) {
        if (!f.slug.value || !f.email.value || f.password.value.length < 6) throw new Error('Completa cuenta, correo y contraseña (mínimo 6 caracteres).');
        const r = await api('/api/register', {
          method: 'POST', auth: false,
          body: { tenant_id: tenantId, slug: f.slug.value, name: tenant.name, business_type: type, email: f.email.value, password: f.password.value, device_name: deviceName },
        });
        device = { ...device, id: r.device_id, token: r.token };
        tenant = r.tenant;
      }
      const seed = buildSeed({
        type, tenantId, businessName: tenant.name, ownerName: f.owner.value.trim(), pin,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await setMeta('tenant', tenant);
      await setMeta('device', device);
      await setMeta('branch_id', seed.branchId);
      await setMeta('demo', !cloud);
      await setMeta('cursor', 0);
      const rows = Object.entries(seed.rows).flatMap(([t, list2]) => list2.map((r) => [t, r]));
      await save(rows);
      await login(seed.rows.users[0]);
      toast('¡Listo! Tu negocio está creado.');
      onDone();
    } catch (e) {
      busy(false);
      setErr(e.status ? e.message : (e.message || 'Sin conexión. Desmarca "Crear cuenta en la nube" para empezar sin internet.'));
    }
  }

  async function link(f) {
    setErr('');
    busy(true);
    try {
      const byPass = !el.querySelector('#by-pass').hidden;
      const body = { slug: slugify(f.slug.value), device_name: f.device.value.trim() };
      const r = byPass
        ? await api('/api/login', { method: 'POST', auth: false, body: { ...body, email: f.email.value, password: f.password.value } })
        : await api('/api/link', { method: 'POST', auth: false, body: { ...body, code: f.code.value } });
      await setMeta('tenant', r.tenant);
      await setMeta('device', { id: r.device_id, name: body.device_name, token: r.token, mode: 'pos' });
      await setMeta('demo', false);
      await setMeta('cursor', 0);
      await syncNow();
      const branches = list('branches', (b) => b.active !== 0);
      if (!branches.length) throw new Error('No se pudo descargar el negocio. Revisa tu conexión.');
      if (branches.length === 1) {
        await setMeta('branch_id', branches[0].id);
        onDone();
      } else {
        el.innerHTML = `<div class="setup narrow"><h2>¿En qué sucursal está este dispositivo?</h2><div class="type-grid">${branches.map((b) => `<button class="type-card" data-act="branch" data-id="${b.id}"><span>🏪</span><b>${esc(b.name)}</b></button>`).join('')}</div></div>`;
      }
    } catch (e) {
      busy(false);
      setErr(e.message || 'No se pudo conectar');
    }
  }

  async function forgot() {
    const f = el.querySelector('#f');
    const slug = slugify(f.slug.value);
    const email = f.email.value.trim();
    if (!slug || !email) return setErr('Escribe la cuenta del negocio y el correo del dueño.');
    try {
      const r = await api('/api/password/forgot', { method: 'POST', auth: false, body: { slug, email } });
      if (!r.email) return setErr('El envío de correos no está activo. Pide a tu proveedor de K-POS que restablezca la contraseña.');
      const code = await promptBox('Revisa tu correo', { label: 'Código de 6 dígitos', placeholder: '123456', ok: 'Continuar' });
      if (!code) return;
      const password = await promptBox('Nueva contraseña', { type: 'password', label: 'Mínimo 6 caracteres', ok: 'Cambiar' });
      if (!password) return;
      await api('/api/password/reset', { method: 'POST', auth: false, body: { slug, code, password } });
      f.password.value = password;
      toast('Contraseña actualizada');
    } catch (err) { setErr(err.message); }
  }

  const onClick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'create') { step = 'type'; draw(); }
    else if (act === 'link') { step = 'link'; draw(); }
    else if (act === 'switch') switchAccount(a.dataset.db);
    else if (act === 'type') { type = a.dataset.type; step = 'create'; draw(); }
    else if (act === 'back') { step = step === 'create' ? 'type' : 'welcome'; draw(); }
    else if (act === 'forgot') forgot();
    else if (act === 'toggle-pass') {
      const p = el.querySelector('#by-pass');
      p.hidden = !p.hidden;
      el.querySelector('#by-code').hidden = !p.hidden;
      a.textContent = p.hidden ? 'Usar correo y contraseña del dueño' : 'Usar código de vinculación';
    } else if (act === 'branch') {
      await setMeta('branch_id', a.dataset.id);
      onDone();
    }
  };
  el.addEventListener('click', onClick);
  draw();
  return () => el.removeEventListener('click', onClick);
}

