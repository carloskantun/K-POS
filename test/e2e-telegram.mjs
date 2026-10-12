// Prueba aislada: Telegram simulado, sin credenciales ni mensajes reales.
import {chromium} from 'playwright';
import {createEnv,startServer} from '../hub/server.js';
import worker from '../worker/src/index.js';
import {mkdir} from 'node:fs/promises';
const env=await createEnv(':memory:',{RATE_LIMIT:'off',TELEGRAM_BOT_TOKEN:'mock',TELEGRAM_WEBHOOK_SECRET:'hook',TELEGRAM_BOT_USERNAME:'kpos_avisos_bot'});
const originalFetch=globalThis.fetch,sent=[];
globalThis.fetch=async (url,init)=>{if(String(url).startsWith('https://api.telegram.org/')){sent.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true}));}return originalFetch(url,init);};
const server=await startServer(env,8792),base='http://localhost:8792';
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('https://t.me/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<h1>Telegram de prueba</h1>'}));
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
try {
 await mkdir('test-results',{recursive:true});await page.goto(base);await page.getByText('Crear mi negocio',{exact:true}).click();await page.locator('[data-type=bar]').click();
 await page.fill('[name=name]','Negocio · Telegram');await page.fill('[name=owner]','Dueño');await page.fill('[name=pin]','1234');await page.fill('[name=slug]','telegram-ui');await page.fill('[name=email]','test@example.com');await page.fill('[name=password]','test1234');await page.click('#go');await page.waitForSelector('#nav');
 await page.goto(base+'/#/settings?s=telegram');await page.getByRole('heading',{name:'1. Conectar Telegram a Negocio · Telegram'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-act=tg-group]')?.disabled===false);
 const groupOpened=page.waitForEvent('popup');await page.getByRole('button',{name:'Conectar grupo de Telegram',exact:true}).click();const popup=await groupOpened;await popup.waitForURL('https://t.me/**');
 const url=new URL(popup.url()),code=url.searchParams.get('startgroup');check(code?.length===64,'Lleva la vinculación segura al grupo');
 const hook=await worker.fetch(new Request(base+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'hook'},body:JSON.stringify({message:{text:`/start@kpos_avisos_bot ${code}`,chat:{id:-10017,type:'supergroup',title:'Grupo negocio de prueba'}}})}),env,{waitUntil(){}});
 check(hook.status===200,'Webhook del grupo');check(sent.at(-1).text.includes('Chat vinculado con <b>Negocio · Telegram'),'Aviso identifica el negocio correcto');
 await popup.close();await page.bringToFront();await page.getByRole('button',{name:'Comprobar vinculación',exact:true}).click();await page.getByText('Grupo negocio de prueba',{exact:true}).waitFor();
 const privateOpened=page.waitForEvent('popup');await page.getByRole('button',{name:'Recibir en mi chat privado',exact:true}).click();const privatePopup=await privateOpened;await privatePopup.waitForURL('https://t.me/**');check(new URL(privatePopup.url()).searchParams.get('start')?.length===64,'Enlace privado distinto del grupo');await privatePopup.close();
 await page.getByText('Vincular con código manual',{exact:true}).click();await page.getByRole('button',{name:'Generar código',exact:true}).click();await page.locator('#tg-code .code').waitFor();await page.getByRole('button',{name:'Comprobar vinculación',exact:true}).click();await page.getByText('Grupo negocio de prueba',{exact:true}).waitFor();
 await page.getByText('Vincular con código manual',{exact:true}).click();
 await page.evaluate(()=>{for(let p=document.querySelector('[data-act=tg-group]');p;p=p.parentElement)p.scrollTop=0;});
 await page.screenshot({path:'test-results/telegram-connect-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{for(let p=document.querySelector('[data-act=tg-group]');p;p=p.parentElement)p.scrollTop=0;});await page.screenshot({path:'test-results/telegram-connect-mobile.png',fullPage:true});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sin desbordamiento móvil');
 // Verifica que la alternativa de enlace sigue disponible cuando el navegador bloquea ventanas.
 await page.evaluate(()=>{window.open=()=>null;});await page.getByRole('button',{name:'Conectar grupo de Telegram',exact:true}).click();await page.getByRole('link',{name:'Elegir grupo en Telegram',exact:true}).waitFor();
 check(await page.getByRole('link',{name:'Elegir grupo en Telegram',exact:true}).getAttribute('href').then(h=>new URL(h).searchParams.has('startgroup')),'Alternativa si no se abre Telegram');
 check(errors.length===0,errors.join('\n'));console.log('OK: grupo automático, vinculación, privado, código manual y ventanas bloqueadas; computadora y celular.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;}
