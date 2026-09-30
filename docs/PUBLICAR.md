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
