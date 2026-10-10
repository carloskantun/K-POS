import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocationMods } from '../public/js/shared/combinations.js';
import { buildSeed } from '../public/js/shared/presets.js';
import { buildRockMenu } from '../public/js/shared/rockalitas.js';
import { createEnv, migrate } from '../hub/server.js';
import worker from '../worker/src/index.js';
import { push } from '../worker/src/sync.js';
import { dayRange } from '../public/js/shared/util.js';

test('reparto 5+5 y tacos: total exacto, precios y consumo proporcional por paquete', () => {
  const g={id:'g',name:'Carnes',type:'allocation',total:20,unit:'tacos',options:[{id:'a',name:'Pastor',price:0,product_id:'pastor',qty:0.04},{id:'b',name:'Tripa',price:2,product_id:'tripa',qty:0.05}]};
  const mods=allocationMods(g,{a:10,b:10});
  assert.equal(mods[0].name,'10 tacos · Pastor');
  assert.equal(mods[0].qty,0.4); assert.equal(mods[1].qty,0.5); assert.equal(mods[1].price,20);
  assert.throws(()=>allocationMods(g,{a:10,b:5})); assert.throws(()=>allocationMods(g,{a:10.5,b:9.5})); assert.throws(()=>allocationMods(g,{a:10,b:9,c:1}));
  const seeded=buildSeed({type:'rockalitas',tenantId:'r',businessName:'Rock',ownerName:'X',pin:'1234'}).rows.products;
  const loaded=buildRockMenu().filter(([t])=>t==='products').map(([,p])=>p);
  for(const products of [seeded,loaded]) {
    const wings=products.find(p=>p.id==='rockalitas-menu-alitas-10'), group=wings.modifiers[0];
    assert.equal(group.total,10); assert.equal(group.type,'allocation');
    const split=allocationMods(group,{[group.options[0].id]:5,[group.options[1].id]:5});
    assert.equal(split.reduce((sum,m)=>sum+m.price,0),0); assert.equal(wings.price,320);
    assert.equal(products.find(p=>p.id==='rockalitas-menu-paquete-led').modifiers[0].total,40);
  }
});

test('KPIs: periodos comparables, zona horaria, propinas separadas e aislamiento de sucursales', async () => {
  const env=await createEnv(':memory:');const waits=[];const ctx={waitUntil:p=>waits.push(p)};
  const response=await worker.fetch(new Request('http://test/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenant_id:'11111111-1111-1111-1111-111111111111',slug:'kpis-test',name:'KPI',email:'k@p.mx',password:'secret123'})}),env,ctx);
  const {token}=await response.json();
  const seed=buildSeed({type:'rockalitas',tenantId:'11111111-1111-1111-1111-111111111111',businessName:'KPI',ownerName:'Dueño',pin:'1234',timezone:'America/Cancun'});
  await push(env,'11111111-1111-1111-1111-111111111111',Object.entries(seed.rows).flatMap(([t,rows])=>rows.map(r=>({t,r}))));
  const now=Date.now(), at=date=>dayRange(date,'America/Cancun').from+60000;
  const order=(id,date,total,branch=seed.branchId,status='paid')=>({t:'orders',r:{id,updated_at:now,number:1,branch_id:branch,user_id:seed.rows.users[0].id,status,total,opened_at:at(date),closed_at:status==='paid'?at(date):null,table_id:status==='open'?'mesa-1':null}});
  await push(env,'11111111-1111-1111-1111-111111111111',[order('new','2026-10-10',320),order('prior','2026-10-03',160),order('outside','2026-10-10',999,'otra'),order('open','2026-10-10',60,seed.branchId,'open'),{t:'payments',r:{id:'pay',updated_at:now,order_id:'new',branch_id:seed.branchId,amount:320,tip:32,method:'efectivo',created_at:at('2026-10-10')}}]);
  const get=async path=>{const r=await worker.fetch(new Request(`http://test${path}`,{headers:{authorization:`Bearer ${token}`}}),env,ctx);await Promise.all(waits.splice(0));return {status:r.status,data:await r.json()};};
  const {data:r}=await get(`/api/reports/kpis?date=2026-10-10&days=7&branch=${seed.branchId}`);
  assert.equal(r.current.total,320);assert.equal(r.previous.total,160);assert.equal(r.current.average,320);assert.equal(r.current.tips,32);assert.equal(r.current.by_day['2026-10-10'],320);assert.equal(r.current.open_balance,60);assert.equal(r.current.occupied_tables,1);
  assert.equal((await get('/api/reports/kpis?date=2026-02-31&days=7')).status,400);
  assert.equal((await get('/api/reports/kpis?date=2026-10-10&days=365')).status,400);
  assert.equal((await get('/api/reports/kpis?date=2026-10-10&days=7&branch=otro-negocio')).data.current.total,0);
});

test('migración conserva precios y grupos personalizados; cambios de alitas llegan por cursor', async () => {
  const env=await createEnv(':memory:');
  await env.DB.prepare("INSERT INTO tenants (id,slug,name,owner_email,owner_pass,seq,created_at) VALUES ('migration','migration','Rock','x@y.mx','mock',5,1)").run();
  const group=[{id:'g',name:'Salsa de la casa',required:true,max:1,options:[{id:'a',name:'BBQ',price:0}]}];
  await push(env,'migration',[{t:'products',r:{id:'rockalitas-menu-alitas-10',updated_at:1,name:'Mi nombre',price:999,modifiers:group}},{t:'products',r:{id:'rockalitas-menu-alitas-20',updated_at:1,name:'Personalizado',price:500,modifiers:[{...group[0],name:'Mi grupo'}]}}]);
  await env.DB.prepare("DELETE FROM _migrations WHERE name='0005_combinations_telegram.sql'").run();
  await env.DB.exec('DROP TABLE telegram_outbox');await migrate(env.DB);
  const rows=(await env.DB.prepare("SELECT id,name,price,modifiers,seq FROM products WHERE tenant_id='migration' ORDER BY id").all()).results;
  const ten=await env.DB.prepare("SELECT seq FROM tenants WHERE id='migration'").first();
  assert.equal(rows[0].price,999);assert.equal(rows[0].name,'Mi nombre');assert.equal(JSON.parse(rows[0].modifiers)[0].total,10);assert.equal(rows[0].seq,ten.seq);
  assert.equal(JSON.parse(rows[1].modifiers)[0].type,undefined);
});


test('snapshot de inventario conserva movimientos pendientes sin contar dos veces los recibidos', async () => {
  const {mergeStockSnapshot}=await import('../public/js/shared/stock.js');
  const levels=[{branch_id:'b',product_id:'salsa',qty:1}], moves=[{id:'local',branch_id:'b',product_id:'salsa',qty:-0.4},{id:'recibido',branch_id:'b',product_id:'salsa',qty:1}];
  assert.equal(mergeStockSnapshot(levels,moves,new Set(['recibido']))[0].qty,0.6);
  assert.equal(mergeStockSnapshot([],moves.slice(0,1))[0].qty,-0.4);
});
