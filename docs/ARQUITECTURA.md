# Arquitectura de K-POS

## 1. Un dominio, una subcuenta por negocio

```
                        ┌──────────────────────────────────────────┐
  taqueria-lupita.kpos.mx ─┐                                         │
  bar-el-gallo.kpos.mx  ───┼──▶  Cloudflare Worker (uno solo)        │
  abarrotes-pepe.kpos.mx ──┘     ├─ /           PWA (assets)          │
                                 ├─ /api/sync   push / pull           │──▶ D1 (una base, tenant_id en cada fila)
                                 ├─ /api/telegram/webhook             │
                                 └─ cron cada hora → resúmenes        │──▶ Telegram
                        └──────────────────────────────────────────┘
```

- **Multi-tenant en una sola base D1**: cada fila lleva `tenant_id` y la llave primaria es `(tenant_id, id)`,
  así un negocio nunca puede leer ni pisar datos de otro (probado en `test/api.test.js`).
- **El subdominio es la "subcuenta"**: además de ser la dirección que le das a tu cliente, cada subdominio es un
  *origen* distinto en el navegador, por lo que cada negocio tiene su propia app instalada y su propia base local.
  Si un dispositivo abre el dominio raíz, igual puede vincularse escribiendo la cuenta.
- **Autenticación por dispositivo**: el dueño crea la cuenta (correo + contraseña, PBKDF2). Cada tablet o celular
  se vincula con un **código de 6 dígitos** que vence en 15 minutos y recibe un token propio (revocable en
  Ajustes → Dispositivos). Dentro del dispositivo, cada persona entra con su **PIN**, que se valida localmente
  para funcionar sin internet.
- **Escala**: D1 admite 10 GB por base; para cientos de negocios pequeños alcanza de sobra. Si algún cliente crece
  mucho, se puede mover a su propia base D1 sin cambiar la app (el Worker solo elige otra `env.DB`).

## 2. Cómo trabaja sin internet

Cada dispositivo tiene **una copia completa del negocio en IndexedDB** (catálogo, usuarios, mesas, existencias y
las cuentas de los últimos días). Toda acción se guarda primero ahí:

```
 toque en "Taco al pastor"
        │
        ▼
 IndexedDB (fila nueva)  +  outbox (cola de "pendiente de subir")  ──▶ la pantalla se actualiza al instante
        │
        ▼ cuando hay red (cada 4 s, al reconectar o al volver a la app)
 POST /api/sync/push  ──▶ D1   ──▶   GET /api/sync/pull?since=cursor  ◀── los demás dispositivos
```

- El **service worker** guarda la app, así que abre aunque no haya red.
- El indicador arriba a la derecha muestra `En línea`, `Sin conexión · N por subir` o `Modo local`.
- **Sin internet se puede**: vender, cobrar, enviar comandas (a la pantalla del mismo dispositivo o de la red local,
  ver punto 4), mover inventario, abrir y cerrar caja. Al volver la conexión todo se sube solo.

### Reglas para que no se pierda ni se duplique nada

| Situación | Regla |
|---|---|
| Dos dispositivos editan la misma fila | Gana la versión con `updated_at` más reciente (por fila, no por tabla). |
| Un dispositivo atrasado intenta "regresar" un estado | Los estados solo avanzan: una cuenta **pagada** no vuelve a **abierta**; un platillo **listo** no vuelve a **en preparación**; una caja **cerrada** no se reabre. El servidor rechaza y devuelve la versión vigente. |
| Movimientos de inventario, pagos y movimientos de caja | Son **solo inserción** e idempotentes por id: reenviarlos no los duplica. El id del movimiento de una venta se deriva del id del platillo (`sm-<item>`), así que ni reintentos ni dos dispositivos pueden descontar dos veces. |
| Existencias | No se sincroniza "cuánto hay", se sincronizan **movimientos** (+entrada, −venta, −merma, ±conteo). La existencia es la suma. Dos cajas vendiendo cervezas sin internet al mismo tiempo cuadran al reconectar. |
| Primera sincronización de un dispositivo nuevo | Baja catálogo completo + existencias ya sumadas + solo los últimos 3 días de cuentas. El dispositivo borra historial de más de 7 días que ya subió; la nube conserva todo (reportes de fechas viejas se piden al servidor). |

### Inventario proporcional (recetas)

Un producto puede tener receta: `Taco al pastor = 2 × Tortilla + 0.035 kg × Carne al pastor`,
`Cubeta = 6 × Cerveza`. Al **enviar la comanda o cobrar** se descuentan los insumos. La tarjeta del producto
muestra cuántas porciones alcanzan con lo que queda (el mínimo entre sus insumos). Si se cancela un platillo ya
enviado se pregunta si los insumos regresan al inventario (no, si ya se preparó y se tiró).

## 3. Un mismo POS para giros distintos

El giro elegido al crear el negocio solo define **módulos activos** y un **catálogo de ejemplo** (`public/js/shared/presets.js`).
Todo se puede cambiar después en Ajustes → Negocio.

| Giro | Mesas | Comandas | Meseros | Recetas | Código de barras | Granel | Mayoreo |
|---|---|---|---|---|---|---|---|
| Taquería | – | ✔ | ✔ | ✔ | | | |
| Restaurante / Bar | ✔ | ✔ (cocina + barra) | ✔ | ✔ | | | |
| Cafetería | – | ✔ (barra) | | ✔ | | | |
| Abarrotes / Minisúper | | | | | ✔ | | |
| Frutería / Verdulería | | | | | | ✔ | |
| Mayoreo | | | | | ✔ | | ✔ |
| Papelería | | | | | ✔ | | |

Flujos que salen de esa combinación:

- **Taquería con una tablet**: se toca la foto, "Enviar comanda" (a nombre de Juan / Para llevar) y la misma
  tablet —o una segunda pantalla en modo cocina— muestra al taquero cuántos tacos de cada uno tiene pendientes.
- **Restaurante / bar**: el mesero abre la mesa desde su celular, agrega y envía; cocina y barra ven solo lo suyo;
  cuando cocina marca "listo", la mesa parpadea en verde en el mapa del mesero.
- **Abarrotes / minisúper**: el lector de código de barras (USB o Bluetooth, funciona como teclado) agrega directo.
- **Frutería**: los productos por kilo abren un teclado con ¼, ½, ¾, 1 kg o "por importe" (dame $20 de limón).
- **Mayoreo**: a partir de N piezas se aplica el precio de mayoreo automáticamente.

## 4. Varios dispositivos sin internet: servidor local (hub)

Un dispositivo solo, sin internet, funciona completo. Pero para que **el celular del mesero le mande la comanda a
la tablet de cocina cuando no hay internet**, necesitan un punto de encuentro en la red del local. Un navegador no
puede ser servidor, así que la opción es un **hub**: cualquier PC, mini PC o Raspberry Pi en el Wi-Fi del negocio
corriendo `node hub/server.js`. El hub ejecuta **exactamente el mismo Worker** sobre SQLite (adaptador en
`hub/d1.js`), así que el protocolo y las reglas de sincronización son idénticos.

```
          ┌─────────── Wi-Fi del local (el router sigue funcionando aunque no haya internet) ──────────┐
 Celular mesero ──┐                                                                               │
 Tablet cocina  ──┼──▶  Hub local (mini PC / Raspberry)  ── cuando hay internet ──▶  Cloudflare     │
 Caja           ──┘      node hub/server.js (Worker + SQLite)                        (fase 2)      │
          └──────────────────────────────────────────────────────────────────────────────────────┘
```

Recomendación por tipo de cliente:

| Cliente | Configuración |
|---|---|
| Taquería / abarrotes con 1 dispositivo | Solo la nube. Sin internet sigue vendiendo; sube al reconectar. |
| Varios dispositivos, internet estable | Solo la nube (lo más simple). Si se cae el internet, cada dispositivo sigue vendiendo por su cuenta y todo se junta al volver; lo único que se pausa es la comanda entre dispositivos. |
| Restaurante/bar donde la comanda no puede fallar | Hub local en el Wi-Fi (fase 2: puente hub ↔ nube). |

Notas del hub:

- Para que la app se instale como PWA en otros dispositivos, el navegador exige **HTTPS** (salvo `localhost`).
  En red local sin TLS la app funciona (IndexedDB y la sincronización sí), pero sin el modo "abrir sin red" del
  service worker; para eso se puede poner un certificado local (mkcert) o un Cloudflare Tunnel.
- El código ya evita APIs que solo existen en HTTPS (`crypto.randomUUID`, `crypto.subtle` para PIN).

## 5. Telegram

```
cron (cada hora) ──▶ ¿es la hora del resumen de este negocio en SU zona horaria? ──▶ sendMessage
push de caja cerrada ──▶ mensaje de corte (esperado, contado, sobrante/faltante, tarjeta, transferencia)
push de venta que deja un producto ≤ mínimo ──▶ alerta de stock bajo (máximo una por producto por día)
```

- El dueño genera un código en **Ajustes → Telegram** y lo manda al bot (`/vincular 123456`) en su chat privado o
  en un **grupo con los socios**. Un mismo chat puede recibir varios negocios.
- Resumen diario (hora configurable) con: ventas, tickets, ticket promedio, por método de pago, cancelaciones,
  más vendidos, por mesero/cajero, cortes de caja con diferencia, stock bajo y existencias.
- Avisos opcionales de "cómo va el día" a las horas que elijas (ej. 14:00 y 20:00).
- Comandos: `/resumen`, `/hoy`, `/stock`, `/inventario`, `/caja`, `/desvincular`.
- El reporte de Telegram y la pantalla de Reportes usan **la misma función** (`public/js/shared/report.js`), así
  que siempre cuadran.
- Un mismo registro (`notify_log`) evita mensajes duplicados si el cron se reintenta.

## 6. Modelo de datos

Tablas sincronizadas (`public/js/shared/schema.js`, espejo en `worker/migrations/0001_init.sql`):

`config` (ajustes del negocio) · `branches` · `users` · `categories` · `products` (precio, unidad, foto, estación,
receta, stock mínimo, mayoreo) · `tables` · `orders` (cuenta) · `order_items` (con estado de comanda) ·
`payments` · `stock_moves` · `cash_sessions` (turnos/cortes) · `cash_moves`.

Tablas solo de servidor: `tenants`, `devices`, `link_codes`, `telegram_chats`, `notify_log`.

## 7. Seguridad

- Contraseña del dueño con PBKDF2-SHA256 (100k iteraciones); tokens de dispositivo guardados como hash.
- Cada petición de sincronización está limitada al `tenant_id` del token; las columnas se filtran por lista blanca.
- El PIN es un bloqueo de conveniencia para cambiar de usuario rápido (4 dígitos), no una credencial fuerte:
  las acciones sensibles (cancelar, descuentos, ajustes) dependen del rol.
- Webhook de Telegram validado con `X-Telegram-Bot-Api-Secret-Token`.

## 8. Siguientes pasos sugeridos

1. **Puente hub ↔ nube**: que el hub local se vincule a la cuenta como un dispositivo más y reenvíe push/pull.
2. **Tiempo real** con Durable Objects (WebSocket) para comandas instantáneas en vez de consulta cada 4 s.
3. **Fotos en R2** en lugar de guardarlas en la fila del producto (hoy: JPEG 256 px ≈ 15 KB).
4. **Impresión térmica** ESC/POS por Bluetooth/USB (hoy: `window.print()` con formato de 58/80 mm).
5. Pagos divididos, propinas, clientes/crédito (fiado), facturación CFDI, corte por mesero.
6. Panel de administración para ti (alta de clientes, planes, suspensión por falta de pago).
7. Límite de intentos en login/vinculación (Rate Limiting de Cloudflare).
