// Instancia y datos desechables; no modifica el negocio real.
import { chromium } from 'playwright';
import { createEnv,startServer } from '../hub/server.js';
import { mkdir } from 'node:fs/promises';
const env=await createEnv(':memory:',{RATE_LIMIT:'off'}), server=await startServer(env,8791), base='http://localhost:8791';
const browser=await chromium.launch();const errors=[];
const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}), page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));

const check=(ok,msg)=>{if(!ok)throw Error(msg);};
try {
  await mkdir('test-results',{recursive:true});await page.goto(base);
  await page.getByText('Crear mi negocio',{exact:true}).click();await page.locator('[data-type=rockalitas]').click();
  await page.fill('[name=name]','Rock · Prueba combinaciones');await page.fill('[name=owner]','Carlos');await page.fill('[name=pin]','1234');
  await page.fill('[name=slug]','rock-combinaciones');await page.fill('[name=email]','test@example.com');await page.fill('[name=password]','test1234');await page.click('#go');await page.waitForSelector('#nav');
  await page.evaluate(async()=> {
    const {save,S,branchId}=await import('/js/store.js');
    const p=S.data.products.get('rockalitas-menu-alitas-10');const groups=structuredClone(p.modifiers);
    groups[0].options[0].product_id='salsa-test';groups[0].options[0].qty=0.02;
    await save([['products',{id:'salsa-test',name:'Salsa insumo',unit:'kg',price:0,track_stock:1,stock_min:0.1,active:1,sellable:0,recipe:[],modifiers:[]}],['products',{...p,modifiers:groups}],['stock_moves',{id:'in-test',branch_id:branchId(),product_id:'salsa-test',qty:1,kind:'count',created_at:Date.now()}]]);
  });
  await page.goto(base+'/#/tables');await page.locator('.table-card',{hasText:'Mesa 1'}).first().click();
  await page.evaluate(async()=>{window.kposStore=await import('/js/store.js');});
  await page.locator('.card',{hasText:'Alitas · 10 piezas'}).click();
  check(await page.locator('[data-act=ok]').isDisabled(),'No permite agregar sin repartir');
  await page.locator('[data-count]').nth(0).fill('5');await page.locator('[data-count]').nth(1).fill('5');
  await page.locator('[data-act=inc]').click();
  await page.screenshot({path:'test-results/combinations-desktop.png'});
  await page.locator('[data-act=ok]').click();await page.waitForSelector('.ticket .line');
  check((await page.locator('.l-mods').textContent()).includes('5 piezas'),'Combinación visible en cuenta');
  check((await page.locator('.t-total b').textContent()).trim()==='$640.00','Dos paquetes a precio correcto');
  await page.locator('.card',{hasText:'Alitas · 10 piezas'}).click();await page.locator('[data-act=fill]').nth(0).click();await page.locator('[data-act=ok]').click();
  await page.locator('.ticket .line').nth(1).waitFor();
  check(await page.locator('.ticket .line').count()===2,'Las combinaciones distintas no se fusionan');
  await page.click('[data-act=send]');
  await page.waitForFunction(()=>Math.abs(window.kposStore.stockOf('salsa-test')-0.6)<0.001);
  const stock=await page.evaluate(async()=> {const {stockOf}=await import('/js/store.js');return stockOf('salsa-test');});
  check(Math.abs(stock-0.6)<0.001,`Salsa consumida según piezas y paquetes: ${stock}`);
  await page.goto(base+'/#/kitchen');await page.waitForSelector('.kmods');check((await page.locator('.kmods').first().textContent()).includes('5 piezas'),'Cocina recibe cantidades');
  await page.goto(base+'/#/tables');await page.locator('.table-card',{hasText:'Mesa 1'}).first().click();await page.waitForSelector('[data-act=pay]');await page.click('[data-act=pay]');await page.click('.modal [data-act=method][data-m=tarjeta]');await page.click('.modal [data-act=tip][data-p="10"]');await page.click('.modal [data-act=confirm]');await page.waitForSelector('.done');await page.click('.modal [data-act=close]');
  await page.evaluate(async()=>{const {syncNow}=await import('/js/sync.js');await syncNow();});
  await page.waitForFunction(()=>!window.kposStore.S.syncing && !window.kposStore.S.pending);
  await page.goto(base+'/#/results');await page.getByText('Datos de todos los dispositivos sincronizados',{exact:false}).waitFor();
  check((await page.locator('.kpi').nth(0).textContent()).includes('$960.00'),'KPIs ventas correctas');check((await page.locator('.kpi').nth(3).textContent()).includes('$96.00'),'Propina fuera de ventas');
  await page.selectOption('#kdays','30');await page.getByText('Datos de todos los dispositivos sincronizados',{exact:false}).waitFor();await page.screenshot({path:'test-results/results-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/results-mobile.png',fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Resultados no desbordan en celular');
  await page.goto(base+'/#/pos');await page.locator('.card',{hasText:'Alitas · 10 piezas'}).click();await page.locator('[data-count]').nth(0).fill('5');await page.locator('[data-count]').nth(1).fill('5');await page.screenshot({path:'test-results/combinations-mobile.png',fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Opciones no desbordan en celular');
  check(errors.length===0,errors.join('\n'));console.log('OK: combinaciones, cocina, inventario, cobro y KPIs; desktop y celular.');
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
