# Publicar K-POS sin dominio (Cloudflare workers.dev)

Todo corre en la capa gratuita de Cloudflare para empezar (Workers, D1 y Durable Objects con SQLite).
La app queda en `https://k-pos.<tu-subdominio>.workers.dev`, con HTTPS, lista para instalarse en celulares y tablets.

## 1. Una sola vez, desde tu computadora

```bash
npm install                             # instala wrangler
npx wrangler login                      # abre el navegador para autorizar tu cuenta de Cloudflare
npx wrangler d1 create k-pos            # copia el "database_id" que imprime
```

Pega el `database_id` en `wrangler.toml` (línea `REEMPLAZAR_CON_ID_DE_D1`), y luego:

```bash
npm run db:migrate                                  # crea las tablas en D1
npx wrangler secret put ADMIN_KEY                   # tu clave para /admin.html (larga y aleatoria)
npx wrangler secret put TELEGRAM_BOT_TOKEN          # token que te da @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET     # cualquier texto aleatorio
npx wrangler secret put RESEND_API_KEY              # opcional: recuperar contraseña por correo
npm run deploy
```

`wrangler deploy` imprime la dirección final (`https://k-pos.<algo>.workers.dev`).

En `wrangler.toml` → `[vars]` pon `TELEGRAM_BOT_USERNAME = "NombreDeTuBot"` (sin @) y vuelve a publicar.

## 2. Conectar el bot de Telegram

```bash
curl -X POST https://k-pos.<algo>.workers.dev/api/admin/telegram-setup -H "x-admin-key: TU_ADMIN_KEY"
```

## 3. Publicar automáticamente desde GitHub (opcional)

El flujo `.github/workflows/deploy.yml` corre las pruebas, aplica migraciones y publica. En el repositorio
(Settings → Secrets and variables → Actions) agrega:

| Secreto | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token de Cloudflare con permisos *Workers Scripts: Edit*, *D1: Edit* y *Account Settings: Read* |
| `CLOUDFLARE_ACCOUNT_ID` | Id de tu cuenta (aparece en el panel de Workers) |
| `D1_DATABASE_ID` | El id de la base creada arriba |

Si falta alguno de los tres secretos, el flujo ejecuta las pruebas y omite la publicación con un aviso.
Los cambios en `main` quedan guardados aunque todavía no hayas configurado Cloudflare.

Luego en GitHub → Actions → **Publicar** → *Run workflow*. Cada publicación cambia la versión del service worker,
así que las tablets toman la actualización solas al reabrir la app.

## 4. Cuando compres dominio

1. Agrega el dominio a Cloudflare.
2. En `wrangler.toml` pon `ROOT_DOMAIN = "tudominio.mx"` y descomenta las `routes`.
3. En DNS crea `*.tudominio.mx` (proxied).
4. `npm run deploy`. Cada cliente podrá usar `sucliente.tudominio.mx`; la dirección workers.dev sigue funcionando.

## 5. Tu panel de clientes

`https://k-pos.<algo>.workers.dev/admin.html` → escribe tu `ADMIN_KEY`. Ahí ves cada negocio, sus ventas de la
semana, dispositivos y última conexión; registras plan y fecha de pago; generas códigos para conectar tablets
en remoto; cambias la contraseña del dueño; y **suspendes** o reactivas (una cuenta suspendida sigue vendiendo en
sus dispositivos, pero deja de sincronizar hasta que la reactives).

## Costos de referencia

Para decenas de negocios pequeños el plan gratuito de Workers suele alcanzar (100 mil peticiones al día). Cuando
crezca, el plan Workers Paid (5 USD al mes) cubre D1, Durable Objects y límites mucho mayores. Revisa los precios
vigentes en cloudflare.com, cambian con el tiempo.

## Publicación realizada el 6 de octubre de 2026

- POS: https://k-pos.carloskantun.workers.dev
- Panel del proveedor: https://k-pos.carloskantun.workers.dev/admin.html
- Worker `k-pos`, base D1 `k-pos` y Durable Object para avisos de sincronización, en la cuenta de Carlos.
- Dominio propio pendiente; todos los negocios usan la misma dirección y se identifican por su cuenta al conectar.
- Se migró exclusivamente Rock Alitas (`rock-alitas`) desde la base local: 48 productos, 3 usuarios y sus cuentas/pagos existentes. Las cuentas de prueba locales de taquería no se migraron.
- Se creó `pruebas-kpos`, con catálogo de ejemplo y sin existencias iniciales. Usarlo para demostraciones y futuras pruebas de pagos.
- Los accesos y el respaldo local se guardaron en una carpeta privada fuera del repositorio. La clave administrativa de producción es distinta de `admin-test`.
- Telegram, recuperación por correo y Mercado Pago todavía no están conectados. Ver [Mercado Pago](MERCADO-PAGO.md).
- La publicación automática desde GitHub sigue pendiente de su token de Cloudflare; la publicación inicial se hizo usando la sesión local autorizada.

Para entrar a un negocio desde la URL pública: **Conectar este dispositivo → Usar correo y contraseña del dueño**, escribir su cuenta y entrar después con el PIN del usuario. Los datos del navegador en localhost no se trasladan automáticamente a otra dirección. La copia de Rock Alitas subida corresponde a lo sincronizado en la base local al momento de la migración; cualquier cambio que hubiese quedado exclusivamente en la cola del navegador requiere revisión antes de continuar trabajando en ambos entornos.
