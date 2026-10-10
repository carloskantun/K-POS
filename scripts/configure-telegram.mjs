// El JSON de credenciales debe estar fuera del repositorio. Nunca imprime el token.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const file=process.argv[2];
async function main() {
  if(!file) throw Error('Indica un archivo JSON privado con TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET.');
  let secrets;
  try { secrets=JSON.parse(await readFile(file,'utf8')); } catch { throw Error('No se pudo leer el JSON privado. Revisa el archivo sin compartir su contenido.'); }
  if(!/^\d+:[\w-]+$/.test(secrets.TELEGRAM_BOT_TOKEN||'')) throw Error('Completa el token del bot en el archivo privado.');
  if(!/^[A-Za-z0-9_-]{16,256}$/.test(secrets.TELEGRAM_WEBHOOK_SECRET||'')) throw Error('El secreto de webhook requiere entre 16 y 256 letras, números, guiones o guiones bajos.');
  // Para no instalar otros secretos accidentalmente, el archivo solo lleva estas dos claves.
  if(Object.keys(secrets).some(k=>!['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET'].includes(k))) throw Error('Usa un archivo que contenga únicamente los dos secretos de Telegram.');
  const origin=process.argv[3]||'https://k-pos.carloskantun.workers.dev';
  if(new URL(origin).protocol!=='https:') throw Error('El webhook requiere una dirección HTTPS.');
  async function telegram(method,body={}) {
    let data;
    try {const res=await fetch(`https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});data=await res.json();} catch {throw Error('No se pudo contactar Telegram.');}
    if(!data.ok) throw Error(`Telegram no aceptó la operación ${method}. Revisa el token y vuelve a intentar.`);
    return data.result;
  }
  const bot=await telegram('getMe');
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk',file],{encoding:'utf8',timeout:120000});
  if(result.status!==0) throw Error('No se pudieron guardar los secretos en Cloudflare. Revisa la sesión de Wrangler.');
  await telegram('setWebhook',{url:`${origin.replace(/\/$/,'')}/api/telegram/webhook`,secret_token:secrets.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','channel_post']});
  await telegram('setMyCommands',{commands:[{command:'hoy',description:'Ventas, caja e inventario de hoy'},{command:'resumen',description:'Resumen de ayer'},{command:'inventario',description:'Existencias actuales'},{command:'stock',description:'Productos con stock bajo'},{command:'caja',description:'Cuentas y caja'}]});
  console.log(`Bot @${bot.username} conectado. En el POS abre Ajustes → Telegram para vincular el grupo mediante un código.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
