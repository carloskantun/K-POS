import {round3} from './util.js';
// Una foto del servidor no incluye movimientos locales todavía pendientes de subir.
export function mergeStockSnapshot(levels, pending, receivedIds = new Set()) {
  const map=new Map(levels.map(r=>[`${r.branch_id}|${r.product_id}`,{...r,qty:round3(r.qty)}]));
  for(const r of pending) {
    if(r.deleted || receivedIds.has(r.id)) continue;
    const key=`${r.branch_id}|${r.product_id}`;
    const level=map.get(key)||{branch_id:r.branch_id,product_id:r.product_id,qty:0};
    level.qty=round3(level.qty+Number(r.qty||0));map.set(key,level);
  }
  return [...map.values()];
}
