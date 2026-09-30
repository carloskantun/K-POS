// Prueba de navegador del flujo de un bar-restaurante (Rockalitas):
//   node hub/server.js (con ADMIN_KEY=admin-test)   →   node test/e2e-bar.mjs [url] [carpeta]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = process.argv[3] || 'test-results';
const slug = `rock-${Date.now().toString(36)}`;
const errors = [];
const log = (...a) => console.log('•', ...a);
const check = (cond, msg) => { if (!cond) throw new Error(msg); };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
};
const card = (page, name) => page.locator('.card', { hasText: name }).first();
const pin = async (page, digits, scope = '') => { for (const d of digits) await page.click(`${scope}[data-k="${d}"]`); };
const stockOf = async (page, name) => (await page.locator('.inv-row', { hasText: name }).first().locator('.ir-qty b').textContent()).trim();

// ---------- Caja / dueño (tablet) ----------
const owner = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
watch(owner, 'caja');
await owner.goto(BASE);
await owner.getByText('Crear mi negocio').click();
await owner.locator('[data-type="bar"]').click();
await owner.fill('[name=name]', 'Rockalitas');
await owner.fill('[name=owner]', 'Dueño');
await owner.fill('[name=pin]', '1234');
await owner.fill('[name=slug]', slug);
await owner.fill('[name=email]', 'dueno@rockalitas.mx');
await owner.fill('[name=password]', 'rock1234');
await owner.click('#go');
await owner.waitForSelector('#nav');
log('Rockalitas creado', slug);

// Alta de mesero con PIN
await owner.goto(`${BASE}/#/settings?s=users`);
await owner.click('[data-act=new-user]');
await owner.fill('.modal [name=name]', 'Toño');
await owner.selectOption('.modal [name=role]', 'mesero');
await owner.fill('.modal [name=pin]', '2222');
await owner.click('.modal .btn.primary');
await owner.waitForSelector('.inv-row:has-text("Toño")');
await owner.goto(`${BASE}/#/settings?s=device`);
await owner.click('[data-act=link-code]');
const code = (await owner.locator('#code-box .code').textContent()).trim();
log('mesero dado de alta, código', code);

// ---------- Celular del mesero ----------
const waiter = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
watch(waiter, 'mesero');
await waiter.goto(BASE);
await waiter.getByText('Conectar este dispositivo').click();
await waiter.fill('[name=slug]', slug);
await waiter.fill('[name=device]', 'Cel Toño');
await waiter.fill('[name=code]', code);
await waiter.click('#go');
await waiter.locator('.user-tile', { hasText: 'Toño' }).click();
await pin(waiter, '2222');
await waiter.waitForSelector('.tables-view');
await waiter.locator('.table-card', { hasText: 'Mesa 5' }).click();

// Alitas: dos salsas + extra ($165 + $15)
await card(waiter, 'Alitas').click();
await waiter.locator('.mod-opt', { hasText: 'BBQ' }).click();
await waiter.locator('.mod-opt', { hasText: 'Mango habanero' }).click();
await waiter.locator('.mod-opt', { hasText: 'Aderezo ranch' }).click();
await waiter.screenshot({ path: `${OUT}/bar-01-extras.png` });
await waiter.click('.modal [data-act=ok]');
// Michelada con Corona y Clamato ($75 + $10)
await card(waiter, 'Michelada').click();
check(await waiter.locator('.modal [data-act=ok]').isDisabled(), 'no debe dejar agregar sin elegir lo obligatorio');
await waiter.locator('.mod-opt', { hasText: 'Corona' }).click();
await waiter.locator('.mod-opt', { hasText: 'Clamato' }).click();
await waiter.click('.modal [data-act=ok]');
// Cubeta de Victoria
await card(waiter, 'Cubeta').click();
await waiter.locator('.mod-opt', { hasText: 'Victoria' }).click();
await waiter.click('.modal [data-act=ok]');
await waiter.click('[data-act=open-cart]');
await waiter.waitForTimeout(250);
const total1 = (await waiter.locator('.t-total b').textContent()).trim();
check(total1 === '$505.00', `total mesa 5 = ${total1}`);
await waiter.screenshot({ path: `${OUT}/bar-02-pedido.png` });
await waiter.click('[data-act=send]');
await waiter.waitForSelector('.tables-view .table-card.busy');
log('mesero envió Mesa 5:', total1);

// ---------- Pantallas de barra y cocina (en la tablet del dueño) ----------
await owner.goto(`${BASE}/#/kitchen`);
await owner.waitForSelector('.kds-card', { timeout: 15000 });
await owner.locator('[data-act=station][data-s=barra]').click();
const barra = await owner.locator('.kds-board').textContent();
check(/Michelada/.test(barra) && /Clamato/.test(barra) && !/Alitas/.test(barra), `barra: ${barra}`);
await owner.screenshot({ path: `${OUT}/bar-03-barra.png` });
await owner.locator('[data-act=station][data-s=cocina]').click();
const cocina = await owner.locator('.kds-board').textContent();
check(/Alitas/.test(cocina) && /BBQ, Mango habanero, Aderezo ranch/.test(cocina), `cocina: ${cocina}`);
await owner.screenshot({ path: `${OUT}/bar-04-cocina.png` });
await owner.locator('[data-act=station][data-s=all]').click();
await owner.click('[data-act=all-ready]');
await owner.waitForSelector('.kds-empty');
log('barra ve la michelada, cocina ve las alitas con sus salsas');

// ---------- El mesero cancela la michelada: necesita PIN de encargado ----------
await waiter.locator('.table-card', { hasText: 'Mesa 5' }).click();
await waiter.click('[data-act=open-cart]');
await waiter.waitForSelector('.line.ready:has-text("Michelada")', { timeout: 15000 });
await waiter.locator('.line', { hasText: 'Michelada' }).locator('.l-info').click();
await waiter.click('.modal [data-act=cancel]');
await pin(waiter, '2222', '.modal ');
await waiter.waitForSelector('.modal #err:has-text("sin permiso")');
await pin(waiter, '1234', '.modal ');
await waiter.fill('.modal input[name=v]', 'Se equivocó de cerveza');
await waiter.click('.modal .btn.primary');
await waiter.click('.modal [data-act=yes]');
await waiter.waitForSelector('.line.cancelled');
log('cancelación autorizada por el encargado');

// Dividir: la cubeta pasa a otra cuenta de la misma mesa
await waiter.click('[data-act=order-menu]');
await waiter.click('.modal [data-act=split]');
await waiter.locator('.modal .line', { hasText: 'Cubeta' }).locator('[data-act=minc]').click();
await waiter.click('.modal [data-act=to-new]');
await waiter.fill('.modal input[name=v]', 'Amigos de la barra');
await waiter.click('.modal:last-of-type .btn.primary');
await waiter.waitForTimeout(400);
const total2 = (await waiter.locator('.t-total b').textContent()).trim();
check(total2 === '$180.00', `mesa 5 tras dividir = ${total2}`);
await waiter.screenshot({ path: `${OUT}/bar-05-dividida.png` });
log('cuenta dividida: Mesa 5 queda en', total2);

// ---------- Caja: abrir, cobrar Mesa 5 mixto con propina ----------
await owner.goto(`${BASE}/#/cash`);
await owner.click('[data-act=open]');
await pin(owner, '500', '.modal ');
await owner.click('.modal [data-act=ok]');
await owner.waitForSelector('.cash [data-act=close]');
await owner.goto(`${BASE}/#/tables`);
await owner.locator('.table-card', { hasText: 'Mesa 5' }).click();
await owner.waitForSelector('.ticket .line');
for (let i = 0; i < 20 && (await owner.locator('.t-total b').textContent()).trim() !== '$180.00'; i++) await owner.waitForTimeout(250);
await owner.click('[data-act=pay]');
await owner.click('.modal [data-act=method][data-m=tarjeta]');
await owner.click('.modal [data-act=half]');
await owner.click('.modal [data-act=add-pay]');
await owner.click('.modal [data-act=method][data-m=efectivo]');
await owner.click('.modal [data-act=tip][data-p="10"]');
await owner.click('.modal [data-act=bill][data-v="100"]');
await owner.screenshot({ path: `${OUT}/bar-06-pago-mixto.png` });
await owner.click('.modal [data-act=confirm]');
await owner.waitForSelector('.done .change');
const change = (await owner.locator('.done .change').textContent()).trim();
check(change === '$1.00', `cambio = ${change}`);
await owner.click('.modal [data-act=close]');
log('Mesa 5 cobrada: $90 tarjeta + $90 efectivo + $9 propina, cambio', change);

// Inventario: Victoria −6 (cubeta), Corona sin cambio (michelada cancelada con devolución)
await owner.goto(`${BASE}/#/inventory`);
const vic = await stockOf(owner, 'Victoria');
const cor = await stockOf(owner, 'Corona');
check(vic === '114' && cor === '120', `inventario victoria=${vic} corona=${cor}`);
log('inventario por variante: Victoria', vic, '· Corona', cor);

// Caja esperada: 500 + 90 efectivo + 9 propina
await owner.goto(`${BASE}/#/cash`);
const expected = (await owner.locator('.kpi.hl b').textContent()).trim();
check(expected === '$599.00', `esperado en caja = ${expected}`);

// Reportes: propinas y bitácora
await owner.goto(`${BASE}/#/reports`);
await owner.waitForSelector('.kpi');
const rep = await owner.locator('.reports').textContent();
check(/Propinas/.test(rep) && /autorizó Dueño/.test(rep), 'reporte con propinas y bitácora');
await owner.screenshot({ path: `${OUT}/bar-07-reportes.png`, fullPage: true });
log('reporte con propinas y cancelación autorizada; caja espera', expected);

// ---------- Panel de administración ----------
const admin = await (await browser.newContext({ viewport: { width: 1280, height: 700 } })).newPage();
watch(admin, 'admin');
await admin.goto(`${BASE}/admin.html`);
await admin.fill('[name=key]', 'admin-test');
await admin.click('#login .btn.primary');
await admin.waitForSelector(`#list td:has-text("${slug}")`);
await admin.screenshot({ path: `${OUT}/bar-08-admin.png` });
log('panel admin muestra a Rockalitas');

console.log(errors.length ? `\nERRORES:\n${errors.join('\n')}` : '\nSin errores de consola');
await browser.close();
process.exit(errors.length ? 1 : 0);
