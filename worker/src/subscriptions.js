// Planes y cobranza de K-POS. No son pagos de las ventas del restaurante.
import { uid } from '../../public/js/shared/util.js';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const text=(v,max)=>typeof v==='string' && v.length<=max;
const cents=v=>Number.isSafeInteger(v)&&v>0&&v<=100000000;
const timestamp=v=>Number.isSafeInteger(v)&&v>0&&v<=8640000000000000;
const cycles=['monthly','yearly','once','manual'];
export async function subscriptions(request,env,path){
 const b=request.method==='POST'?await request.json().catch(()=>({})):{};
 if(path==='/api/admin/plans'&&request.method==='GET'){
  const r=await env.DB.prepare('SELECT * FROM subscription_plans ORDER BY active DESC, name').all();return json({plans:r.results});
 }
 if(path==='/api/admin/plans/save'&&request.method==='POST'){
  if(!text(b.name,80)||!b.name.trim()||!text(b.description||'',1000)||!text(b.includes||'',3000)||!cycles.includes(b.cycle)||!(b.price_cents==null||cents(b.price_cents)||b.price_cents===0)||![0,1].includes(b.active??1))return json({error:'Revisa nombre, precio, periodicidad y contenido del paquete.'},400);
  const id=b.id||uid();const now=Date.now();
  if(b.id&&!await env.DB.prepare('SELECT id FROM subscription_plans WHERE id=?').bind(id).first())return json({error:'Paquete no encontrado.'},404);
  await env.DB.prepare('INSERT INTO subscription_plans (id,name,description,price_cents,cycle,includes,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,cycle=excluded.cycle,includes=excluded.includes,active=excluded.active,updated_at=excluded.updated_at').bind(id,b.name.trim(),b.description||'',b.price_cents??null,b.cycle,b.includes||'',b.active??1,now,now).run();return json({ok:true,id});
 }
 if(path==='/api/admin/billing'&&request.method==='GET'){
  const id=new URL(request.url).searchParams.get('id');
  if(!await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(id).first())return json({error:'Cliente no encontrado.'},404);
  const r=await env.DB.batch([
   env.DB.prepare('SELECT c.*,COALESCE((SELECT SUM(r.amount_cents) FROM subscription_receipts r WHERE r.charge_id=c.id AND r.voided_at IS NULL),0) AS paid_cents FROM subscription_charges c WHERE tenant_id=? ORDER BY due_at DESC,created_at DESC').bind(id),
   env.DB.prepare('SELECT * FROM subscription_receipts WHERE tenant_id=? ORDER BY paid_at DESC,created_at DESC').bind(id)
  ]);return json({charges:r[0].results,receipts:r[1].results});
 }
 if(path==='/api/admin/billing/charge'&&request.method==='POST'){
  if(!text(b.concept,160)||!b.concept.trim()||!cents(b.amount_cents)||!timestamp(b.due_at)||![b.period_start,b.period_end].every(v=>v==null||timestamp(v))||(b.period_start&&b.period_end&&b.period_end<b.period_start))return json({error:'Revisa concepto, importe, vencimiento y periodo.'},400);
  if(!await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(b.tenant_id).first())return json({error:'Cliente no encontrado.'},404);
  const id=uid();await env.DB.prepare('INSERT INTO subscription_charges (id,tenant_id,concept,amount_cents,due_at,period_start,period_end,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,b.tenant_id,b.concept.trim(),b.amount_cents,b.due_at,b.period_start??null,b.period_end??null,Date.now()).run();return json({ok:true,id},201);
 }
 if(path==='/api/admin/billing/receipt'&&request.method==='POST'){
  if(!cents(b.amount_cents)||!timestamp(b.paid_at)||b.paid_at>Date.now()+86400000||!['cash','transfer','card','other'].includes(b.method)||!text(b.reference||'',160))return json({error:'Revisa importe, fecha, método y referencia.'},400);
  // Inserción condicionada y atómica: dos cobros concurrentes no exceden el saldo.
  const id=uid();const r=await env.DB.prepare(`INSERT INTO subscription_receipts (id,tenant_id,charge_id,amount_cents,paid_at,method,reference,created_at)
   SELECT ?,tenant_id,id,?,?,?,?,? FROM subscription_charges c WHERE c.id=? AND c.tenant_id=? AND c.voided_at IS NULL
   AND c.amount_cents-COALESCE((SELECT SUM(amount_cents) FROM subscription_receipts WHERE charge_id=c.id AND voided_at IS NULL),0)>=?`).bind(id,b.amount_cents,b.paid_at,b.method,b.reference||'',Date.now(),b.charge_id,b.tenant_id,b.amount_cents).run();
  if(!r.meta.changes)return json({error:'El cargo no existe, está anulado o el importe supera su saldo.'},409);return json({ok:true,id},201);
 }
 if(path==='/api/admin/billing/void'&&request.method==='POST'){
  if(!text(b.reason,500)||!b.reason.trim()||!['charge','receipt'].includes(b.kind))return json({error:'Indica el motivo de anulación.'},400);
  const table=b.kind==='charge'?'subscription_charges':'subscription_receipts';
  const guard=b.kind==='charge'?' AND NOT EXISTS (SELECT 1 FROM subscription_receipts WHERE charge_id=subscription_charges.id AND voided_at IS NULL)':'';
  const r=await env.DB.prepare(`UPDATE ${table} SET voided_at=?,void_reason=? WHERE id=? AND tenant_id=? AND voided_at IS NULL${guard}`).bind(Date.now(),b.reason.trim(),b.id,b.tenant_id).run();
  if(!r.meta.changes)return json({error:'No se puede anular. Revisa si tiene cobros vigentes o ya fue anulado.'},409);return json({ok:true});
 }
 return json({error:'Ruta o método no permitido.'},405);
}
export async function updateTenant(env,b){
 const old=await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(b.id).first();if(!old)return json({error:'Cliente no encontrado.'},404);
 const t={...old,...b};
 if(!text(t.name,80)||!t.name.trim()||!text(t.owner_email,254)||!/^\S+@\S+\.\S+$/.test(t.owner_email)||!['active','trial','suspended'].includes(t.status)||!text(t.plan||'',120)||!text(t.notes||'',1000)||!text(t.contact_phone||'',80)||!text(t.plan_includes||'',3000)||!(t.price_cents==null||t.price_cents===0||cents(t.price_cents))||(t.billing_cycle&&!cycles.includes(t.billing_cycle))||!['paid_until','service_start','trial_until','next_charge_at'].every(k=>t[k]==null||timestamp(t[k])))return json({error:'Revisa los datos, importes y fechas del cliente.'},400);
 if(t.service_start&&t.paid_until&&t.paid_until<t.service_start)return json({error:'La fecha de servicio cubierto no puede ser anterior al inicio.'},400);
 if(t.plan_id&&!await env.DB.prepare('SELECT id FROM subscription_plans WHERE id=?').bind(t.plan_id).first())return json({error:'Paquete no encontrado.'},400);
 // Conserva el nombre en el POS y avisa mediante la secuencia de sincronización.
 const now=Date.now();await env.DB.batch([
 env.DB.prepare('UPDATE tenants SET name=?,owner_email=?,status=?,plan=?,paid_until=?,notes=?,plan_id=?,price_cents=?,billing_cycle=?,plan_includes=?,contact_phone=?,service_start=?,trial_until=?,next_charge_at=?,seq=seq+1 WHERE id=?').bind(t.name.trim(),t.owner_email.trim().toLowerCase(),t.status,t.plan||null,t.paid_until??null,t.notes||null,t.plan_id||null,t.price_cents??null,t.billing_cycle||null,t.plan_includes||null,t.contact_phone||null,t.service_start??null,t.trial_until??null,t.next_charge_at??null,t.id),
 env.DB.prepare("UPDATE config SET value=json_set(value,'$.name',?),updated_at=?,seq=(SELECT seq FROM tenants WHERE id=?) WHERE tenant_id=? AND id='business'").bind(t.name.trim(),now,t.id,t.id)
 ]);return json({ok:true});
}
