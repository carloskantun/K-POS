# K-POS

Punto de venta **PWA** para negocios pequeños y medianos: taquerías, restaurantes, bares, cafeterías,
abarrotes/minisúper, fruterías/verdulerías, mayoreo, papelerías y más.

- **Se instala desde el navegador** en celular, tablet, iPad o computadora. No hay tienda de apps de por medio.
- **Funciona sin internet**: cada dispositivo guarda todo localmente y sincroniza al reconectar.
- **Un solo sistema, muchos giros**: al crear el negocio eliges el giro y se activan los módulos que usa
  (mesas, comandas, meseros, recetas/insumos, código de barras, granel, mayoreo).
- **Multi-negocio**: un dominio, un subdominio por cliente (`taqueria-lupita.kpos.mx`), una base D1.
- **Reportes a Telegram**: resumen diario de ventas, caja e inventario; aviso de corte de caja; alertas de stock bajo.

## Qué hace

| Pantalla | Para quién | Qué resuelve |
|---|---|---|
| **Vender** | Caja, mesero | Cuadrícula de fotos (o emoji). Toque = agregar. Botón verde **+** y rojo **−** en el pedido y en la tarjeta. Existencias visibles en cada producto. Notas por platillo ("sin cebolla"). |
| **Mesas** | Mesero | Mapa de mesas libre / ocupada / 🔔 listo para llevar. Cada mesero entra con su PIN. |
| **Comandas** | Cocina, taquero, barra | Tarjetas por cuenta con minutos de espera y colores; **totales por producto** ("12 tacos al pastor"); sonido al llegar pedidos; filtro Cocina/Barra. |
| **Inventario** | Encargado | Existencias, entradas de mercancía, mermas, **conteo rápido**, historial. Descuento automático por **receta** (1 taco = 2 tortillas + 35 g de carne; 1 cubeta = 6 cervezas). |
| **Caja** | Cajero | Apertura con fondo, entradas/salidas, **corte** por denominación con esperado vs. contado (sobrante/faltante). |
| **Reportes** | Dueño | Ventas, tickets, métodos de pago, por hora, más vendidos, por usuario, caja y stock bajo. |
| **Ajustes** | Dueño | Productos con foto de la cámara, categorías, usuarios y roles, mesas, sucursales, dispositivos, Telegram. |

Roles: **Dueño**, **Encargado**, **Cajero**, **Mesero**, **Cocina/Barra**. Una taquería con una sola tablet
funciona igual que un restaurante con 5 meseros y 2 pantallas de cocina: solo cambia qué módulos están activos.

## Probarlo en tu computadora

Requiere Node 22.5+ (usa `node:sqlite`, sin dependencias).

```bash
npm run dev          # http://localhost:8787 (y la IP de tu red local para otros dispositivos)
npm test             # pruebas de sincronización, reportes y bot de Telegram
```

`npm run dev` levanta el **mismo Worker** que corre en Cloudflare, sobre SQLite local.
Puedes crear el negocio "sin cuenta en la nube" (modo local) o con cuenta para probar varios dispositivos.

Prueba de navegador de punta a punta (dos dispositivos, venta, comanda, cobro, modo sin conexión, corte):

```bash
npm run dev &
npx playwright install chromium   # solo la primera vez
node test/e2e.mjs http://localhost:8787 test-results
```

## Desplegar en Cloudflare

```bash
npx wrangler d1 create k-pos                 # copia el database_id a wrangler.toml
npm run db:migrate                           # crea las tablas en D1
npx wrangler secret put TELEGRAM_BOT_TOKEN   # token de @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ADMIN_KEY
npm run deploy
```

1. En `wrangler.toml` pon tu dominio en `ROOT_DOMAIN` y el usuario del bot en `TELEGRAM_BOT_USERNAME`.
2. En Cloudflare DNS agrega `*.tudominio` (proxied) y las rutas del Worker (`tudominio/*` y `*.tudominio/*`).
3. Registra el webhook del bot una vez:
   ```bash
   curl -X POST https://tudominio/api/admin/telegram-setup -H "x-admin-key: TU_ADMIN_KEY"
   ```
4. El cron (cada hora) manda a cada negocio su resumen a la hora que eligió en **Ajustes → Telegram**.

Cada despliegue: sube `VERSION` en `public/sw.js` para que los dispositivos tomen la nueva versión.

## Estructura

```
public/                 PWA (HTML/CSS/JS sin build, se sirve como assets del Worker)
  js/shared/            Código compartido PWA ↔ Worker: esquema, giros, reportes, utilidades
  js/views/             Pantallas: vender, mesas, comandas, inventario, caja, reportes, ajustes
  js/store.js, db.js    Base local (IndexedDB) + cola de cambios pendientes
  js/sync.js            Sincronización push/pull
  sw.js                 Service worker (abre sin internet)
worker/src/             Cloudflare Worker: API, sincronización, reportes, bot de Telegram, cron
worker/migrations/      Esquema D1
hub/                    Servidor local (Node + SQLite) que corre el mismo Worker: desarrollo y red local sin internet
test/                   Pruebas (node --test) y prueba de navegador (Playwright)
docs/ARQUITECTURA.md    Decisiones de diseño, sincronización offline, multi-negocio y siguientes pasos
```

Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) para el detalle de cómo funciona sin internet y entre dispositivos.
