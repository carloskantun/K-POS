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

Además:

- **Extras y variantes**: salsas, término, marca de la cubeta, "+ queso $15"; se eligen al vender, salen en la comanda
  y pueden descontar inventario (cubeta de Victoria = 6 Victorias).
- **Cobro completo**: pago mixto, dividir entre personas, propinas, dividir la cuenta o pasar productos a otra
  cuenta, unir mesas, pre-cuenta.
- **Control anti-robo hormiga**: cancelar lo enviado o dar descuentos pide **PIN de encargado** y queda en una
  bitácora visible en Reportes y en Telegram.
- **Impresión**: ticket y comanda por impresora del sistema/AirPrint o térmica ESC/POS por Bluetooth o USB;
  la tablet de barra/cocina imprime sola lo que le llega.
- **Tiempo real**: las comandas llegan al instante (Durable Objects); si no hay conexión en vivo, consulta cada 4 s.
- **Excel**: importar y exportar productos en CSV; exportar ventas por rango de fechas.
- **Varios negocios en un mismo celular** (dueño con dos marcas) y recuperación de contraseña por correo.
- **Panel para ti** (`/admin.html`): crear clientes por giro, elegir catálogo inicial, buscar y filtrar pruebas/clientes oficiales, plan, fecha de pago, suspender/reactivar y códigos de soporte. Incluye regreso al POS.
- **Imágenes de referencia**: ilustraciones por tipo de producto; las fotografías reales cargadas desde Ajustes tienen prioridad.

Guía del alta y revisión de interfaz: [docs/UX-MULTINEGOCIO.md](docs/UX-MULTINEGOCIO.md).

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
RATE_LIMIT=off npm run dev &
npx playwright install chromium   # solo la primera vez
node test/e2e.mjs http://localhost:8787 test-results
ADMIN_KEY=admin-test RATE_LIMIT=off npm run dev &   # para la prueba de bar
node test/e2e-bar.mjs http://localhost:8787 test-results
```

## Publicar

Sin dominio: se publica en `https://k-pos.<tu-cuenta>.workers.dev`. Pasos completos (y publicación automática
desde GitHub Actions) en **[docs/PUBLICAR.md](docs/PUBLICAR.md)**. Guía para dejar operando al primer cliente:
**[docs/GUIA-ROCKALITAS.md](docs/GUIA-ROCKALITAS.md)**.

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

### Instancia publicada

K-POS está disponible en [k-pos.carloskantun.workers.dev](https://k-pos.carloskantun.workers.dev). El [panel de clientes](https://k-pos.carloskantun.workers.dev/admin.html) requiere una clave privada. Rock Alitas y el laboratorio `pruebas-kpos` ya están en D1. Estado y pasos pendientes en [Publicar](docs/PUBLICAR.md); preparación de cobros en [Mercado Pago](docs/MERCADO-PAGO.md).
