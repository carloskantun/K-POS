import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROCKALITAS, buildRockMenu, menuId } from '../public/js/shared/rockalitas.js';
import { buildSeed } from '../public/js/shared/presets.js';

test('menú real: precios de órdenes, paquetes y variantes del menú fotografiado', () => {
  const price = key => ROCKALITAS.products.find(p => p.key === key).price;
  assert.deepEqual([10,20,30].map(n => price(`alitas-${n}`)), [320,440,540]);
  assert.deepEqual(['pueblo','nirvana','iron','led'].map(k => price(`paquete-${k}`)), [360,480,610,740]);
  assert.equal(price('boneless'),260);
  assert.equal(price('burro'),120);
  assert.equal(price('taco-villarock'),40);
  assert.ok(!ROCKALITAS.products.some(p => /lemon tree/i.test(p.name)));
  const rows = buildRockMenu();
  const products = rows.filter(([t]) => t === 'products').map(([,p]) => p);
  assert.ok(products.every(p => p.track_stock === 0 && p.recipe.length === 0));
  const wings = products.find(p => p.id === menuId('alitas-10'));
  assert.equal(wings.modifiers[0].required,true);
  assert.equal(wings.modifiers[0].options.length,7);
});

test('carga repetida conserva precios, nombres editados, categorías y borrados', () => {
  const rows = buildRockMenu();
  const products = rows.filter(([t]) => t === 'products').map(([,p]) => p);
  const categories = rows.filter(([t]) => t === 'categories').map(([,p]) => p);
  products[0].price = 999; products[0].name = 'Nombre propio'; products[1].deleted = 1;
  assert.deepEqual(buildRockMenu(products,categories), []);
  assert.equal(products[0].price,999);
  const reuse = buildRockMenu([{id:'own',name:ROCKALITAS.products[0].name,price:10}], [{id:'cat-own',name:'Alitas',active:1}]);
  assert.ok(!reuse.some(([t,p]) => t === 'products' && p.id === products[0].id));
  assert.equal(reuse.find(([t,p]) => t === 'products' && p.id === menuId('alitas-20'))[1].category_id,'cat-own');
});

test('nuevo negocio Rock Alitas y recarga comparten identidad, sin stock ficticio', () => {
  const {rows} = buildSeed({type:'rockalitas',tenantId:'rock-test',businessName:'Rock Alitas',ownerName:'Carlos',pin:'1234',timezone:'America/Cancun'});
  assert.equal(rows.products.length,ROCKALITAS.products.length);
  assert.equal(rows.stock_moves,undefined);
  rows.products[0].name = 'Alitas de la casa';
  assert.deepEqual(buildRockMenu(rows.products,rows.categories),[]);
  assert.ok(rows.config[0].value.modules.kitchen);
});
