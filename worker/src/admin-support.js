// Lecturas de soporte sin credenciales ni acceso de escritura al POS.
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function supportApi(request,env,path){
 const id=new URL(request.url).searchParams.get('id');
 if(path==='/api/admin/devices/revoke'&&request.method==='POST'){
  const b=await request.json().catch(()=>({}));const r=await env.DB.prepare('UPDATE devices SET revoked=1,current_user_id=NULL WHERE id=? AND tenant_id=?').bind(b.device_id||'',b.tenant_id||'').run();return r.meta.changes?json({ok:true}):json({error:'Dispositivo no encontrado.'},404);
 }
 if(request.method!=='GET')return json({error:'Método no permitido.'},405);
 const tenant=await env.DB.prepare('SELECT id,name,slug,business_type,status FROM tenants WHERE id=?').bind(id||'').first();if(!tenant)return json({error:'Cliente no encontrado.'},404);
 const queries=[
 env.DB.prepare('SELECT id,name,role,active,branch_id FROM users WHERE tenant_id=? AND deleted=0 ORDER BY name').bind(id),
 env.DB.prepare('SELECT d.id,d.name,d.created_at,d.last_seen,d.revoked,d.current_user_id,d.user_seen_at,u.name AS user_name,u.role AS user_role FROM devices d LEFT JOIN users u ON u.tenant_id=d.tenant_id AND u.id=d.current_user_id WHERE d.tenant_id=? ORDER BY d.last_seen DESC').bind(id),
 env.DB.prepare("SELECT value FROM config WHERE tenant_id=? AND id='business'").bind(id)
 ];
 if(path==='/api/admin/snapshot')queries.push(
 env.DB.prepare('SELECT id,name,price,image,emoji,category_id,unit,track_stock,stock_min,sellable FROM products WHERE tenant_id=? AND deleted=0 AND active<>0 ORDER BY sort,name').bind(id),
 env.DB.prepare('SELECT id,name,branch_id FROM tables WHERE tenant_id=? AND deleted=0 AND active<>0 ORDER BY sort,name').bind(id),
 env.DB.prepare('SELECT id,table_id,user_id,customer,number,status,total,opened_at,closed_at FROM orders WHERE tenant_id=? AND deleted=0 ORDER BY opened_at DESC LIMIT 100').bind(id),
 env.DB.prepare('SELECT product_id,branch_id,SUM(qty) AS qty FROM stock_moves WHERE tenant_id=? AND deleted=0 GROUP BY product_id,branch_id').bind(id)
 );
 const r=await env.DB.batch(queries);let config={};try{config=JSON.parse(r[2].results?.[0]?.value||'{}');}catch{}
 return json({tenant,users:r[0].results,devices:r[1].results,modules:config.modules||{},products:r[3]?.results,tables:r[4]?.results,orders:r[5]?.results,stock:r[6]?.results,now:Date.now()});
}
