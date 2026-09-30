// Prueba de extremo a extremo con navegador (no corre en `npm test`):
//   node hub/server.js &   luego   node test/e2e.mjs [http://localhost:8787] [carpeta-capturas]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = process.argv[3] || 'test-results';
const slug = `taq-${Date.now().toString(36)}`;
const errors = [];
const log = (...a) => console.log('•', ...a);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_INTERNET_DISCONNECTED')) errors.push(`${name}: ${m.text()}`); });
};

// ---------- Dispositivo 1: tablet de caja ----------
const ctxA = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const a = await ctxA.newPage();
watch(a, 'caja');
await a.goto(BASE);
await a.getByText('Crear mi negocio').click();
await a.locator('[data-type="taqueria"]').click();
await a.fill('[name=name]', 'Taquería Lupita');
await a.fill('[name=owner]', 'Lupita');
await a.fill('[name=pin]', '1234');
await a.fill('[name=slug]', slug);
await a.fill('[name=email]', 'lupita@example.com');
await a.fill('[name=password]', 'secreto1');
await a.click('#go');
await a.waitForSelector('.pos .card');
log('negocio creado', slug);

// Venta: 3 tacos al pastor + 1 refresco, con nota
const card = (page, name) => page.locator('.card', { hasText: name }).first();
for (let i = 0; i < 3; i++) await card(a, 'Taco al pastor').click();
await card(a, 'Refresco').click();
await a.waitForSelector('.line');
await a.screenshot({ path: `${OUT}/01-pos-taqueria.png` });
const lines = await a.locator('.line').count();
if (lines !== 2) throw new Error(`esperaba 2 líneas, hay ${lines}`);
// rojo − en la tarjeta quita uno
await card(a, 'Taco al pastor').locator('.minus').click();
await a.waitForFunction(() => document.querySelector('.card.in-cart .count')?.textContent === '2');
await card(a, 'Taco al pastor').click();
log('carrito ok (agregar/quitar)');

// Enviar comanda a nombre de "Juan"
await a.click('[data-act=send]');
await a.fill('.modal input[name=v]', 'Juan');
await a.click('.modal .btn.primary');
await a.waitForSelector('.toast');
log('comanda enviada');

// Código para vincular la cocina
await a.goto(`${BASE}/#/settings?s=device`);
await a.click('[data-act=link-code]');
const code = (await a.locator('#code-box .code').textContent()).trim();
log('código de vinculación', code);

// ---------- Dispositivo 2: pantalla de cocina ----------
const ctxB = await browser.newContext({ viewport: { width: 1024, height: 700 } });
const b = await ctxB.newPage();
watch(b, 'cocina');
await b.goto(BASE);
await b.getByText('Conectar este dispositivo').click();
await b.fill('[name=slug]', slug);
await b.fill('[name=device]', 'Cocina');
await b.fill('[name=code]', code);
await b.click('#go');
await b.waitForSelector('.user-tile');
await b.locator('.user-tile').first().click();
for (const d of '1234') await b.click(`[data-k="${d}"]`);
await b.waitForSelector('#nav');
await b.goto(`${BASE}/#/kitchen`);
await b.waitForSelector('.kds-card');
const totals = await b.locator('.kds-totals').textContent();
if (!/3\s*Taco al pastor/.test(totals)) throw new Error(`totales cocina: ${totals}`);
await b.screenshot({ path: `${OUT}/02-comandas.png` });
log('cocina ve la comanda:', totals.trim());
await b.click('[data-act=all-ready]');
await b.waitForSelector('.kds-empty');
log('cocina marcó listo');

// ---------- Caja: abrir caja, cobrar cuenta de Juan ----------
await a.goto(`${BASE}/#/cash`);
await a.click('[data-act=open]');
for (const d of '500') await a.click(`.modal [data-k="${d}"]`);
await a.click('.modal [data-act=ok]');
await a.waitForSelector('[data-act=close]');
await a.goto(`${BASE}/#/pos`);
await a.click('[data-act=accounts]');
await a.locator('.acc', { hasText: 'Juan' }).click();
await a.waitForFunction(() => document.querySelector('.ticket .tag.green'), null, { timeout: 10000 });
await a.click('[data-act=pay]');
await a.click('.modal [data-act=bill][data-v="100"]');
await a.screenshot({ path: `${OUT}/03-cobro.png` });
await a.click('.modal [data-act=confirm]');
await a.waitForSelector('.done .change');
const change = await a.locator('.done .change').textContent();
log('cobrado, cambio', change);
await a.click('.modal [data-act=close]');

// Inventario: tortillas 500 − 3 tacos × 2 = 494; refresco 48 − 1 = 47
await a.goto(`${BASE}/#/inventory`);
const tort = await a.locator('.inv-row', { hasText: 'Tortilla' }).locator('.ir-qty b').textContent();
const ref = await a.locator('.inv-row', { hasText: 'Refresco' }).locator('.ir-qty b').textContent();
if (tort.trim() !== '494' || ref.trim() !== '47') throw new Error(`inventario tortilla=${tort} refresco=${ref}`);
log('inventario proporcional ok: tortillas', tort, 'refrescos', ref);
await a.screenshot({ path: `${OUT}/04-inventario.png` });

// ---------- Sin internet: vender y luego sincronizar ----------
await ctxA.setOffline(true);
await a.goto(`${BASE}/#/pos`);
await a.waitForSelector('.pill.amber', { timeout: 10000 });
await card(a, 'Cerveza').click();
await card(a, 'Cerveza').click();
await a.click('[data-act=pay]');
await a.click('.modal [data-act=bill]');
await a.click('.modal [data-act=confirm]');
await a.waitForSelector('.done');
await a.click('.modal [data-act=close]');
await a.screenshot({ path: `${OUT}/05-offline.png` });
log('venta sin conexión guardada:', (await a.locator('.pill').textContent()).trim());
await ctxA.setOffline(false);
await a.waitForSelector('.pill.green', { timeout: 15000 });
log('reconectado y sincronizado');

// Corte de caja
await a.goto(`${BASE}/#/cash`);
const expected = await a.locator('.kpi.hl b').textContent();
await a.click('[data-act=close]');
await a.click('.modal [data-act=direct]');
const exp = expected.replace(/[^0-9.]/g, '');
for (const d of exp.replace(/\.00$/, '')) await a.click(`.modal:last-of-type [data-k="${d}"]`);
await a.click('.modal:last-of-type [data-act=ok]');
await a.click('.modal [data-act=confirm]');
await a.waitForSelector('[data-act=open]');
log('corte de caja: esperado', expected);

// Reporte en el servidor (lo mismo que recibe Telegram)
const token = await a.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('kpos'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('meta').objectStore('meta').get('device'); q.onsuccess = () => r(q.result.v.token); });
});
await a.waitForSelector('.pill.green', { timeout: 15000 });
const today = await a.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
const rep = await (await fetch(`${BASE}/api/reports/summary?date=${today}`, { headers: { authorization: `Bearer ${token}` } })).json();
log('reporte nube: ventas', rep.total, 'tickets', rep.tickets, 'métodos', JSON.stringify(rep.by_method), 'corte', JSON.stringify(rep.cash.map((c) => [c.expected, c.counted, c.diff])));
if (rep.tickets !== 2 || rep.total !== 149 || rep.cash[0]?.diff !== 0) throw new Error('reporte no cuadra');

await a.goto(`${BASE}/#/reports`);
await a.waitForSelector('.kpi');
await a.screenshot({ path: `${OUT}/06-reportes.png` });

// ---------- Celular del mesero (restaurante) ----------
const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const c = await ctxC.newPage();
watch(c, 'mesero');
await c.goto(BASE);
await c.getByText('Crear mi negocio').click();
await c.locator('[data-type="restaurante"]').click();
await c.fill('[name=name]', 'Fonda Doña Mary');
await c.fill('[name=owner]', 'Mary');
await c.fill('[name=pin]', '4321');
await c.uncheck('[name=cloud]');
await c.click('#go');
await c.waitForSelector('#nav');
await c.goto(`${BASE}/#/tables`);
await c.waitForSelector('.table-card');
await c.locator('.table-card', { hasText: 'Mesa 3' }).click();
await card(c, 'Chilaquiles').click();
await c.locator('.mod-opt', { hasText: 'Verde' }).click();
await c.locator('.mod-opt', { hasText: 'Pollo' }).click();
await c.click('.modal [data-act=ok]');
await card(c, 'Café').click();
await c.screenshot({ path: `${OUT}/07-mesero-movil.png` });
await c.click('[data-act=open-cart]');
await c.waitForTimeout(300);
await c.screenshot({ path: `${OUT}/08-mesero-pedido.png` });
await c.click('[data-act=send]');
await c.waitForSelector('.table-card.busy');
await c.screenshot({ path: `${OUT}/09-mesas.png` });
log('mesero: mesa 3 ocupada');

// Frutería: venta por kilo
const ctxD = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const d = await ctxD.newPage();
watch(d, 'fruteria');
await d.goto(BASE);
await d.getByText('Crear mi negocio').click();
await d.locator('[data-type="fruteria"]').click();
await d.fill('[name=name]', 'Frutería La Huerta');
await d.fill('[name=owner]', 'Beto');
await d.fill('[name=pin]', '1111');
await d.uncheck('[name=cloud]');
await d.click('#go');
await d.waitForSelector('.card');
await card(d, 'Aguacate').click();
await d.click('.modal [data-act=q][data-v="0.5"]');
await d.screenshot({ path: `${OUT}/10-granel.png` });
await d.click('.modal [data-act=ok]');
await d.waitForSelector('.line');
const t = await d.locator('.t-total b').textContent();
log('frutería ½ kg aguacate =', t);

console.log(errors.length ? `\nERRORES:\n${errors.join('\n')}` : '\nSin errores de consola');
await browser.close();
process.exit(errors.length ? 1 : 0);
