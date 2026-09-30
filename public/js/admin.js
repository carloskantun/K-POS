import { PRESETS } from './shared/presets.js';
import { openModal, toast } from './ui.js';

    const $ = (s) => document.querySelector(s);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0);
    const date = (t) => (t ? new Date(t).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
    let key = sessionStorage.getItem('kpos.admin') || '';
    let tenants = [];

    async function call(path, body) {
      const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (res.status === 403) { sessionStorage.removeItem('kpos.admin'); key = ''; show(); throw new Error('Clave incorrecta'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      return data;
    }

    function show() {
      $('#login').hidden = !!key;
      for (const id of ['create','reload','logout','filters']) $(`#${id}`).hidden = !key;
      if (key) load();
      else { $('#list').innerHTML = ''; $('#kpis').innerHTML = ''; }
    }

    async function load() {
      const requestedKey = key;
      $('#feedback').textContent = 'Cargando clientes…';
      try {
        const response = await call('/api/admin/tenants');
        if (key !== requestedKey) return;
        tenants = response.tenants;
        $('#feedback').textContent = '';
      } catch (error) { $('#feedback').textContent = error.message; return; }
      const active = tenants.filter((t) => t.status === 'active');
      const trials = tenants.filter((t) => t.status === 'trial');
      const due = tenants.filter((t) => t.paid_until && t.paid_until < Date.now() && t.status !== 'suspended');
      $('#kpis').innerHTML = `
        <div class="kpi"><small>Clientes</small><b>${tenants.length}</b></div>
        <div class="kpi ok"><small>Clientes activos</small><b>${active.length}</b></div>
        <div class="kpi"><small>Pruebas</small><b>${trials.length}</b></div>
        <div class="kpi ${due.length ? 'bad' : ''}"><small>Pago vencido</small><b>${due.length}</b></div>
        <div class="kpi"><small>Ventas de clientes (7 días)</small><b>${money(tenants.reduce((s, t) => s + t.sales_7d, 0))}</b></div>`;
      drawList();
    }

    function drawList() {
      const q = $('#client-search').value.trim().toLowerCase();
      const status = $('#client-status').value;
      const visible = tenants.filter(t => (status === 'all' || t.status === status) && `${t.name} ${t.slug} ${t.owner_email}`.toLowerCase().includes(q));
      $('#list').innerHTML = `<thead><tr><th>Negocio</th><th>Estado</th><th>Plan / pagado hasta</th><th>Uso (7 días)</th><th>Dispositivos</th><th></th></tr></thead><tbody>
        ${visible.map((t) => `<tr>
          <td data-label="Negocio"><b>${esc(t.name)}</b><small>${esc(t.slug)} · ${esc(t.business_type)} · ${esc(t.owner_email)}</small><small>Alta ${date(t.created_at)}${t.notes ? ` · ${esc(t.notes)}` : ''}</small></td>
          <td data-label="Estado" class="st-${esc(t.status)}">${t.status === 'suspended' ? 'Suspendido' : t.status === 'trial' ? 'Prueba' : 'Activo'}</td>
          <td data-label="Plan / pago">${esc(t.plan || '—')}<small class="${t.paid_until && t.paid_until < Date.now() ? 'due' : ''}">${date(t.paid_until)}</small></td>
          <td data-label="Ventas">${money(t.sales_7d)}<small>${t.tickets_7d} tickets${t.chats ? ' · Telegram ✔' : ''}</small></td>
          <td data-label="Dispositivos">${t.devices}<small>Última conexión ${t.last_seen ? new Date(t.last_seen).toLocaleString('es-MX') : '—'}</small></td>
          <td data-label="Acciones"><div class="row-actions">
            <button class="btn small" data-act="edit" data-id="${t.id}">Editar</button>
            <button class="btn small" data-act="code" data-id="${t.id}">Código</button>
            <button class="btn small" data-act="pass" data-id="${t.id}">Contraseña</button>
            <button class="btn small ${t.status === 'suspended' ? 'green' : 'danger ghost'}" data-act="toggle" data-id="${t.id}">${t.status === 'suspended' ? 'Reactivar' : 'Suspender'}</button>
          </div></td></tr>`).join('') || `<tr><td class="empty" colspan="6">${tenants.length ? 'No hay clientes con estos filtros.' : 'Aún no hay clientes registrados. Usa Nuevo cliente para dar de alta tu primer negocio. Los negocios en modo local no aparecen aquí.'}</td></tr>`}</tbody>`;
    }

    function createClient() {
      const m = openModal({ title: 'Nuevo cliente', size: 'wide', html: `<form class="form admin-client-form" id="client-form">
        <p class="muted">Crea el negocio y el acceso del dueño. Cada cliente conserva sus datos separados.</p>
        <div class="row2"><div><label for="client-name">Nombre del negocio</label><input id="client-name" name="name" required maxlength="80" autofocus placeholder="Nombre comercial"></div><div><label for="client-owner">Nombre del dueño</label><input id="client-owner" name="owner" required maxlength="80"></div></div>
        <div class="row2"><div><label for="client-slug">Nombre de cuenta</label><input id="client-slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" minlength="3" maxlength="30" placeholder="mi-negocio"><small class="muted">Único, sin espacios. El cliente lo usa para entrar.</small></div><div><label for="client-type">Giro</label><select id="client-type" name="business_type">${Object.entries(PRESETS).filter(([k]) => k !== 'rockalitas').map(([k,p]) => `<option value="${k}" ${k === 'bar' ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div></div>
        <label for="client-catalog">Catálogo inicial</label><select id="client-catalog" name="catalog"><option value="empty">Vacío · Para capturar el menú del cliente</option><option value="sample">Ejemplo del giro · Para demostración</option><option value="rockalitas">Rock Alitas · Menú de prueba fotografiado</option></select><small class="muted">No se asignan existencias iniciales. Las fotos y los precios reales se editan dentro del negocio.</small>
        <div class="row2"><div><label for="client-email">Correo del dueño</label><input id="client-email" name="email" type="email" required autocomplete="off"></div><div><label for="client-password">Contraseña inicial</label><input id="client-password" name="password" type="password" required minlength="6" maxlength="256" autocomplete="new-password"></div></div>
        <div class="row2"><div><label for="client-pin">PIN del dueño</label><input id="client-pin" name="pin" type="password" required pattern="[0-9]{4}" maxlength="4" inputmode="numeric" autocomplete="new-password"><small class="muted">4 dígitos para entrar al punto de venta.</small></div><div><label for="client-state">Estado inicial</label><select id="client-state" name="status"><option value="trial">Prueba</option><option value="active">Activo · Cliente oficial</option></select></div></div>
        <details><summary>Plan y notas comerciales</summary><label for="client-plan">Plan</label><input id="client-plan" name="plan" maxlength="120" placeholder="Nombre o precio del plan"><label for="client-paid">Pagado hasta</label><input id="client-paid" name="paid_date" type="date"><label for="client-notes">Notas</label><textarea id="client-notes" name="notes" maxlength="1000"></textarea></details>
        <p class="error" id="client-error" role="alert" tabindex="-1"></p><div class="actions"><button type="button" class="btn" data-act="close">Cancelar</button><button class="btn primary" id="save-client">Crear cliente</button></div></form>` });
      const form = m.$('#client-form');
      form.business_type.onchange = () => {
        const valid = ['bar','restaurante'].includes(form.business_type.value);
        form.catalog.querySelector('[value=rockalitas]').disabled = !valid;
        if (!valid && form.catalog.value === 'rockalitas') form.catalog.value = 'empty';
      };
      form.onsubmit = async e => {
        e.preventDefault();
        const button = m.$('#save-client');
        if (button.disabled) return;
        button.disabled = true; button.textContent = 'Creando…';
        m.$('#client-error').textContent = '';
        const fields = Object.fromEntries(new FormData(form));
        const paid = fields.paid_date ? Date.parse(`${fields.paid_date}T23:59:59-05:00`) : null;
        try {
          const result = await call('/api/admin/tenants/create', { ...fields, paid_until: paid, timezone: 'America/Cancun' });
          m.close(); await load();
          openModal({ title: 'Cliente creado', size: 'small', html: `<p><b>${esc(result.tenant.name)}</b></p><p>Cuenta: <b>${esc(result.tenant.slug)}</b></p><p>El dueño puede entrar desde <b>Conectar este dispositivo → Usar correo y contraseña del dueño</b> usando las credenciales que acabas de definir. Su PIN se usa después para entrar al POS.</p><p class="muted">Se cargaron ${result.products} productos. No se enviaron correos.</p><a class="btn primary" href="/">Volver al POS</a>` });
        } catch (error) { m.$('#client-error').textContent = error.message; m.$('#client-error').focus(); }
        finally { button.disabled = false; button.textContent = 'Crear cliente'; }
      };
    }
    $('#create').onclick = createClient;
    $('#client-search').oninput = drawList;
    $('#client-status').onchange = drawList;

    $('#login').onsubmit = (e) => { e.preventDefault(); key = e.target.key.value.trim(); sessionStorage.setItem('kpos.admin', key); show(); };
    $('#logout').onclick = () => { sessionStorage.removeItem('kpos.admin'); key = ''; tenants = []; $('#feedback').textContent = 'Sesión de superadministrador cerrada.'; show(); };
    $('#reload').onclick = () => load();
    $('#list').onclick = async (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const t = tenants.find((x) => x.id === a.dataset.id);
      try {
        if (a.dataset.act === 'toggle') {
          if (!confirm(`${t.status === 'suspended' ? 'Reactivar' : 'Suspender'} ${t.name}?`)) return;
          await call('/api/admin/tenants/update', { ...t, status: t.status === 'suspended' ? 'active' : 'suspended' });
        } else if (a.dataset.act === 'edit') {
          const plan = prompt('Plan (ej. Básico $299/mes)', t.plan || '');
          if (plan === null) return;
          const until = prompt('Pagado hasta (AAAA-MM-DD)', t.paid_until ? new Date(t.paid_until).toISOString().slice(0, 10) : '');
          if (until === null) return;
          const notes = prompt('Notas', t.notes || '');
          if (notes === null) return;
          await call('/api/admin/tenants/update', { ...t, plan, paid_until: until ? Date.parse(`${until}T23:59:59`) : null, notes });
        } else if (a.dataset.act === 'code') {
          const r = await call('/api/admin/tenants/link-code', { id: t.id });
          alert(`Código para conectar un dispositivo a ${t.name}: ${r.code}\nCuenta: ${t.slug}\nVence en 15 minutos.`);
        } else if (a.dataset.act === 'pass') {
          const p = prompt(`Nueva contraseña para ${t.owner_email}`);
          if (!p) return;
          await call('/api/admin/tenants/reset-password', { id: t.id, password: p });
          alert('Contraseña actualizada');
        }
        load();
      } catch (err) { alert(err.message); }
    };
    show();
