import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { createEnv } from '../hub/server.js';

async function call(env, path, body, key = 'test-key', method = body ? 'POST' : 'GET', token) {
  const res = await worker.fetch(new Request(`http://test.local${path}`, { method, headers: { 'content-type':'application/json','x-admin-key':key, ...(token ? {authorization:`Bearer ${token}`} : {}) }, body:body ? JSON.stringify(body) : undefined }), env, { waitUntil:p=>p.catch(()=>{}) });
  return {status:res.status, data:await res.json()};
}
const client = (slug, extra={}) => ({name:'Cliente oficial',owner:'Dueño',slug,email:`${slug}@example.com`,password:'test-password',pin:'4321',business_type:'bar',catalog:'empty',status:'active',...extra});

test('superadmin crea cliente vacío, el dueño entra y baja sus datos; aislamiento entre clientes', async () => {
  const env=await createEnv(':memory:',{ADMIN_KEY:'test-key',RATE_LIMIT:'off'});
  let batchSize = 0; const originalBatch = env.DB.batch.bind(env.DB);
  env.DB.batch = statements => { batchSize = statements.length; return originalBatch(statements); };
  const a=await call(env,'/api/admin/tenants/create',client('negocio-a'));
  assert.equal(a.status,201);assert.equal(a.data.products,0);
  const b=await call(env,'/api/admin/tenants/create',client('negocio-b',{name:'Rock piloto',catalog:'rockalitas',status:'trial'}));
  assert.equal(b.status,201);assert.equal(b.data.products,48);assert.ok(batchSize < 10, 'alta compacta para D1 gratuito');
  const product=await env.DB.prepare('SELECT modifiers FROM products WHERE tenant_id=? AND name=?').bind(b.data.tenant.id,'Alitas · 10 piezas').first();
  assert.equal(JSON.parse(product.modifiers)[0].options.length,7);
  const login=await call(env,'/api/login',{slug:'negocio-a',email:'negocio-a@example.com',password:'test-password'});
  assert.equal(login.status,200);
  const pull=await call(env,'/api/sync/pull?cursor=0',null,'', 'GET',login.data.token);
  assert.equal(pull.status,200);
  assert.ok(!(await env.DB.prepare('SELECT name FROM products WHERE tenant_id=?').bind(a.data.tenant.id).all()).results.length);
  const cfg=await env.DB.prepare('SELECT value FROM config WHERE tenant_id=?').bind(a.data.tenant.id).first();
  assert.equal(JSON.parse(cfg.value).name,'Cliente oficial');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM stock_moves').first()).n,0);
  const owner=await env.DB.prepare('SELECT pin_hash FROM users WHERE tenant_id=?').bind(a.data.tenant.id).first();assert.ok(owner.pin_hash);assert.notEqual(owner.pin_hash,'4321');
  const tenant=await env.DB.prepare('SELECT owner_pass FROM tenants WHERE id=?').bind(a.data.tenant.id).first();assert.notEqual(tenant.owner_pass,'test-password');
});

test('alta protegida: clave, método, datos, cuenta duplicada y carreras', async () => {
  const env=await createEnv(':memory:',{ADMIN_KEY:'test-key',RATE_LIMIT:'off'});
  assert.equal((await call(env,'/api/admin/tenants/create',client('invalid-key'),'wrong')).status,403);
  assert.equal((await call(env,'/api/admin/tenants/create',null)).status,405);
  for(const change of [{pin:'xx'},{email:'invalido'},{slug:'admin'},{business_type:'unknown'},{catalog:'rockalitas',business_type:'abarrotes'},{timezone:'invalid'}]) assert.equal((await call(env,'/api/admin/tenants/create',client('datos-invalidos',change))).status,400);
  const results=await Promise.all([call(env,'/api/admin/tenants/create',client('same-account')),call(env,'/api/admin/tenants/create',client('same-account'))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM tenants').first()).n,1);
});

test('fallo en la carga inicial revierte todo el alta', async () => {
  const env=await createEnv(':memory:',{ADMIN_KEY:'test-key',RATE_LIMIT:'off'});
  const original=env.DB.batch.bind(env.DB);
  env.DB.batch=statements=>original([...statements,env.DB.prepare('INSERT INTO tabla_inexistente VALUES (1)')]);
  assert.equal((await call(env,'/api/admin/tenants/create',client('batch-failure'))).status,500);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM tenants').first()).n,0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n,0);
});
