// Alta desde superadministración y acceso del dueño; usar un servidor de pruebas.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const BASE=process.argv[2] || 'http://localhost:8790';
const OUT=process.argv[3] || 'test-results';
const key=process.env.ADMIN_KEY;
if(!key)throw Error('Configura ADMIN_KEY para probar el panel.');
await mkdir(OUT,{recursive:true});
const browser=await chromium.launch();
try {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const slug=`cliente-${Date.now().toString(36)}`;
  await p.goto(`${BASE}/admin.html`);await p.fill('#admin-key',key);await p.locator('#login button').click();await p.locator('#create').waitFor({state:'visible'});
  await p.click('#create');await p.fill('#client-name','Rock Alitas · Prueba');await p.fill('#client-owner','Carlos');await p.fill('#client-slug',slug);await p.selectOption('#client-catalog','rockalitas');await p.fill('#client-email',`${slug}@example.com`);await p.fill('#client-password','test-pass123');await p.fill('#client-pin','2468');await p.click('#save-client');
  await p.getByRole('heading',{name:'Cliente creado',exact:true}).waitFor();await p.locator('.modal [data-act=close]').click();
  await p.fill('#client-search',slug);await p.selectOption('#client-status','trial');await p.locator('#list tbody tr').filter({hasText:slug}).waitFor();
  await p.screenshot({path:`${OUT}/admin-desktop.png`});
  await p.setViewportSize({width:375,height:812});
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Admin móvil desbordado');
  await p.screenshot({path:`${OUT}/admin-mobile.png`});
  await p.locator('.admin-back').click();await p.getByText('Conectar este dispositivo',{exact:true}).click();await p.fill('[name=slug]',slug);await p.locator('[data-act=toggle-pass]').click();await p.fill('[name=email]',`${slug}@example.com`);await p.fill('[name=password]','test-pass123');await p.click('#go');await p.waitForSelector('.user-tile');await p.locator('.user-tile').filter({hasText:'Carlos'}).click();for(const n of '2468')await p.locator(`[data-k="${n}"]`).click();await p.waitForSelector('.pos .card');
  if(await p.locator('.pos .card').count()!==48)throw Error('Catálogo no sincronizado');
  const navVisible=await p.locator('#nav a, #nav button').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).length);if(navVisible>5)throw Error('Demasiadas opciones de navegación móvil');
  const clipped=await p.locator('.card .name').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1 || n.scrollHeight>n.clientHeight+1));if(clipped)throw Error('Nombres recortados');
  await p.screenshot({path:`${OUT}/pos-art-mobile.png`});
  await p.locator('.nav-more').click();await p.locator('.modal [data-route=settings]').click();await p.waitForSelector('.settings');
  await p.goto(`${BASE}/#/pos`);await p.locator('.card').filter({hasText:'Alitas · 10 piezas'}).click();await p.locator('.mod-opt').filter({hasText:'Revolución'}).click();if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Opciones de salsa desbordadas');await p.locator('.modal [data-act=ok]').click();
  await p.setViewportSize({width:1440,height:900});await p.screenshot({path:`${OUT}/pos-art-desktop.png`});
  if(errors.length)throw Error(errors.join('\n'));
  console.log('OK: alta, filtros, regreso, acceso del dueño, 48 productos, navegación móvil, nombres e ilustraciones.');
} finally { await browser.close(); }
