// Transcripción de IMG_0447, IMG_0448 e IMG_0449. Precios impresos en MXN.
// No contiene costos, existencias ni recetas: esos datos no aparecen en las fotos.
const sauceOptions = [
  'Las Molotov · Habanero', 'Las Queen Mango · Mango habanero',
  'Las Metalillitas · Búfalo', 'Las Morrison · BBQ/chipotle',
  'Las Beatles · Tamarindo', 'La Revolución de Emiliano Zapata · Jamaica/cacahuate/ajonjolí',
  'Rock & Cheese · Ajo/parmesano (solo fines de semana)',
];
const sauces = (total = null) => ({ ...(total ? { type: 'allocation', total, unit: 'piezas' } : {}), name: 'Salsa de la casa', required: true, max: 1, options: sauceOptions.map(n => [n, 0]) });
const choice = (name, names) => ({ name, required: true, max: 1, options: names.map(n => [n, 0]) });
const food = (key, name, price, cat, detail, mods = []) => ({ key, name, price, cat, detail, emoji: '🍽️', station: 'cocina', mods });
const drink = (key, name, price, cat, detail, mods = []) => ({ key, name, price, cat, detail, emoji: '🥤', station: 'barra', mods });
export const ROCKALITAS_PENDING = [
  'Lemon Tree: precio cortado en IMG_0447.',
  'Los de a $100 varos: varios nombres tapados en IMG_0448; solo Gajos de cebolla está completo.',
  'Marcas de cerveza, sabores de refresco y agua del día: no especificados.',
  'Disponibilidad de Rock & Cheese: confirmar antes de operar.',
];
export const ROCKALITAS = {
  label: 'Rock Alitas · Menú real', emoji: '🎸', tables: 12,
  modules: { tables: true, kitchen: true, waiters: true, recipes: true },
  categories: [
    ['alitas', 'Alitas', '🍗', '#b45309'], ['paquetes', 'Paquetes de alitas', '🍗', '#b45309'],
    ['entradas', 'Entradas y botanas', '🍟', '#dc2626'], ['infantiles', 'Paquetes infantiles', '🍽️', '#15803d'],
    ['tacos', 'Mega taquitos', '🌮', '#b45309'], ['especiales', 'Especiales del barrio', '🌯', '#b45309'],
    ['extras', 'Complementos y aderezos', '🥣', '#475569'], ['cervezas', 'Las chelucas', '🍺', '#b45309'],
    ['miches', 'Las miches', '🍺', '#b45309'], ['tragos', 'Los tragos', '🍹', '#7c3aed'],
    ['shots', 'Shots', '🥃', '#7c3aed'], ['bebidas', 'Sin alcohol', '🥤', '#2563eb'],
  ],
  products: [
    ...[[10,320],[20,440],[30,540]].map(([n,price]) => food(`alitas-${n}`, `Alitas · ${n} piezas`, price, 'alitas', 'Incluye apio/zanahoria y 1 aderezo de 2 oz.', [sauces(n)])),
    ...[['pueblo','Todos somos pueblo',10,360,'1 refresco de sabor, papas con sal, snack de zanahoria y apio, 1 aderezo.'],['nirvana','Nirvana',20,480,'1 refresco de sabor, papas con sal, snack de zanahoria y apio, 2 aderezos.'],['iron','Iron Maiden',30,610,'1 refresco de sabor, papas con sal, snack de zanahoria y apio, 3 aderezos.'],['led','Led Zeppelin',40,740,'2 refrescos de sabor, ½ kilo de papas con sal, snack de zanahoria y apio, 4 aderezos.']].map(([k,n,q,p,d]) => food(`paquete-${k}`, `${n} · ${q} alitas`, p, 'paquetes', d, [sauces(q)])),
    food('crazy', 'Crazy Legs Bucket · 4 piezas',180,'entradas','2 piernitas y 2 muslitos marinados con cajún y salsa de la casa.',[sauces()]),
    food('camarockers','Camarockers · 10 camarones',250,'entradas','Camarones capeados en tempura de cerveza y aderezo cajún; papas y snack de verduras.'),
    food('tiras','Rock a tiras de pollo · 4 piezas',200,'entradas','Incluye aderezo de 2 oz.'),
    food('papas-sal','Papas a la francesa · Con sal',60,'entradas','Orden con sal.'),
    food('papas-sabor','Papas a la francesa · Sazonadas',70,'entradas','Pimienta limón o cajún.',[choice('Sazón',['Pimienta limón','Cajún'])]),
    food('gajos','Gajos de cebolla · 6 piezas',100,'entradas','Incluye aderezo de 2 oz.'),
    food('boneless','Boneless Great Balls of Fire · 8 piezas',260,'entradas','Pechuga de pollo frita y crujiente con salsa de la casa.',[sauces()]),
    food('camartacos','Rock a tacos de Camarrock · 3 tacos',170,'entradas','Camarón capeado, salsa de la casa y verdura de temporada.',[sauces()]),
    food('compartas',"Pa’ que compartas",450,'entradas','4 mega alitas, 2 deditos de queso, gajos de cebolla, 2 banderillas, media canasta veggie, papas y 1 miche de un litro.'),
    food('kids','Leave the Kids Alone',130,'infantiles','6 nuggets de pollo, papas con sal y catsup.'),
    food('salchirockstars','Salchirockstars',130,'infantiles','2 banderillas, papas con sal y catsup.'),
    ...[['res','Los de res','Carne de res al estilo de la casa.'],['longaniza','Los del Profesor Longaniza','Longaniza con pimienta.'],['oink','Puro Oink','Puerquito marinado al estilo Mexa.'],['enchilada','La enchilada','Carne enchilada al estilo del barrio CDMX.'],['villarock','Los Villarock','Res, puerquito, longaniza, carne enchilada, nopales, cebollitas fritas, salsa de 7 chiles y chicharrón seco.']].map(([k,n,d]) => food(`taco-${k}`,n,40,'tacos',d+' Incluye nopalitos y cebolla a elección.',[{name:'Complementos incluidos',required:false,max:0,options:[['Nopalitos',0],['Cebolla',0]]}])),
    food('rockatorta','Rockatorta',80,'especiales','Carnitas de tu preferencia, cebollita frita, nopalitos y salsa de 7 chiles con chicharrón.',[choice('Carne',['Res','Puerquito','Longaniza'])]),
    food('burro','El Sexy Burro',120,'especiales','Mega burrito con carne de tu preferencia, frijoles refritos, lechuga y cebollita frita.',[choice('Carne',['Res','Puerco','Carne enchilada','Longaniza'])]),
    food('nopal','Heavy Nopal',30,'extras','Nopales salteados en orégano, cebolla y chilito de árbol.'),
    food('cebollin','Led Cebollin',30,'extras','Cebollitas fritas bañadas en salsa de la casa.'),
    food('salsa-extra','Extra de salsa',30,'extras','Porción adicional de salsa de la casa.',[sauces()]),
    food('ranch','Aderezo ranch · 2 oz',30,'extras','Porción adicional.'),
    food('catsup','Catsup · 2 oz',30,'extras','Porción adicional.'),
    drink('media','Cerveza · Media',50,'cervezas','Marca por confirmar.'),
    drink('caguama','Cerveza · Caguama',100,'cervezas','Marca por confirmar.'),
    drink('cheladita','La Cheladita · 1 litro',120,'miches','Cerveza, sal y limón.'),
    drink('curo','La Chela Curo Joven? · 1 litro',120,'miches','Michelada estilo ojo rojo.'),
    drink('chi','La Chi Chela Come · 1 litro',120,'miches','Michelada con limón y habanero.'),
    drink('rolling','La Rolling Stone · 1 litro',120,'miches','Michelada clásica con salsitas.'),
    drink('barrio','La del Barrio · 1 litro',120,'miches','Michelada de sabor.',[choice('Sabor',['Tamarindo','Mango','Manzana verde','Fresa'])]),
    drink('tekillers','Tekillers',50,'shots','Shot de tequila de la casa.'),
    drink('blue','El Blue Monday',50,'shots','Vodka de la casa, limón y refresco de lima.'),
    drink('charro','The Black Metal Charro',160,'tragos','Tequila con Coca-Cola.'),
    drink('johnny','Johnny Be Good · 1 litro',160,'tragos','Whisky con agua mineralizada.'),
    drink('rata','El Niño Rata · 1 litro',160,'tragos','Tequila, hielo y jugo de uva o naranja.',[choice('Jugo',['Uva','Naranja'])]),
    drink('vodkabron','Vodkabron · 1 litro',160,'tragos','Vodka con jugo de uva o naranja.',[choice('Jugo',['Uva','Naranja'])]),
    drink('pitufbarrio','El Pitufbarrio',160,'tragos','Azulito con vodka, licor de naranja, bebida de lima y limón.'),
    drink('refresco-sabor','Refresco de sabor · 2 litros',50,'bebidas','Sabores por confirmar.'),
    drink('cola','Refresco cola · 1.35 litros',60,'bebidas','Presentación impresa en el menú.'),
    drink('agua','Agüita del día',30,'bebidas','Pregunta el sabor al mesero.'),
    drink('latita','Latita de refresco',30,'bebidas','Sabores por confirmar.'),
  ],
};

const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export const menuId = key => `rockalitas-menu-${key}`;
export function findMenuProduct(item, products) {
  return products.find(p => p.id === menuId(item.key) || (!p.deleted && norm(p.name) === norm(item.name)));
}
// Solo agrega faltantes. Respeta precios editados, productos borrados y datos de otros negocios.
export function buildRockMenu(products = [], categories = []) {
  const rows = [];
  const catIds = {};
  ROCKALITAS.categories.forEach(([key,name,emoji,color],sort) => {
    const existing = categories.find(c => !c.deleted && c.active !== 0 && norm(c.name) === norm(name));
    let id = menuId(`cat-${key}`);
    let suffix = 1;
    while (!existing && categories.some(c => c.id === id)) id = menuId(`cat-${key}-${suffix++}`);
    catIds[key] = existing?.id || id;
  });
  const missing = ROCKALITAS.products.filter(p => !findMenuProduct(p, products));
  for (const [key,name,emoji,color] of ROCKALITAS.categories) {
    if (!missing.some(p => p.cat === key) || categories.some(c => c.id === catIds[key])) continue;
    rows.push(['categories',{id:catIds[key],name,emoji,color,sort:categories.length+rows.length,active:1}]);
  }
  missing.forEach((p,i) => rows.push(['products',{
    id:menuId(p.key),name:p.name,category_id:catIds[p.cat],price:p.price,cost:0,unit:'pza',
    emoji:p.emoji,image:'',barcode:'',station:p.station,track_stock:0,stock_min:0,
    recipe:[],sort:products.length+i,active:1,sellable:1,price_wholesale:null,wholesale_min:null,
    modifiers:p.mods.map((g,j) => ({id:menuId(`${p.key}-group-${j}`),name:g.name,required:g.required,max:g.max,...(g.type ? {type:g.type,total:g.total,unit:g.unit} : {}),
      options:g.options.map(([name,price],k) => ({id:menuId(`${p.key}-option-${j}-${k}`),name,price}))})),
  }]));
  return rows;
}
