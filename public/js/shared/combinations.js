// Cantidades por paquete: precio y consumo de cada opción son por pieza asignada.
export const isAllocation = g => g.type === 'allocation' && Number.isInteger(Number(g.total)) && Number(g.total) > 0;
export const allocated = counts => Object.values(counts || {}).reduce((sum, n) => sum + Number(n || 0), 0);
export function allocationMods(g, counts) {
  if (!isAllocation(g) || allocated(counts) !== Number(g.total)) throw new Error('Completa la cantidad del paquete');
  if (Object.entries(counts).some(([id,n]) => !g.options.some(o => o.id === id) || !Number.isInteger(n) || n < 0)) throw new Error('Cantidad no válida');
  return g.options.filter(o => counts[o.id] > 0).map(o => {
    const count = counts[o.id];
    return { g: g.name, name: `${count} ${g.unit || 'piezas'} · ${o.name}`, count, option_name: o.name,
      price: Number(o.price || 0) * count,
      ...(o.product_id ? { product_id: o.product_id, qty: Number(o.qty ?? 1) * count } : {}) };
  });
}
