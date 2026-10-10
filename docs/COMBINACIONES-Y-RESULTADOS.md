# Combinaciones, avisos y resultados

## Combinaciones por paquete

En Rock Alitas las órdenes de 10, 20 y 30 alitas y los paquetes de 10, 20, 30 y 40 permiten repartir todas sus piezas entre sabores. Por ejemplo, en una orden de 10 escribe 5 en Habanero y 5 en Búfalo. “Restantes” asigna las piezas pendientes a una opción. Solo se habilita Agregar cuando el reparto está completo.

El precio base se conserva. La cantidad inferior es el número de paquetes con esa misma combinación. Para una combinación diferente agrega otra partida. La cuenta, comanda, ticket y CSV conservan las cantidades de cada sabor.

Para otros negocios: Ajustes → Productos → editar producto → grupo de extras/variantes → “Repartir piezas / combinar”. Configura total, unidad y opciones. Para una orden de 20 tacos puedes ofrecer Pastor y Tripa y repartir 10 + 10. El precio extra de cada opción es por pieza; el insumo y la cantidad de inventario también son por pieza. El consumo resultante se multiplica por los paquetes vendidos. No agregues el mismo insumo además a la receta si ya se descuenta mediante la opción.

La actualización del menú existente convierte solo los grupos originales “Salsa de la casa” de estos siete productos; conserva precios, nombres y opciones. Los grupos personalizados se configuran desde Productos.

## Resultados

En computadora: Resultados. En celular: Más → Resultados. Permite ver 1, 7 o 30 días hasta una fecha y comparar con el periodo anterior de la misma duración. Incluye ventas cobradas, tickets, ticket promedio, propinas, productos, usuarios, medios de pago, cancelaciones y cortes. También muestra cuentas por cobrar, mesas ocupadas e inventario bajo actuales.

Con conexión consulta el historial completo del negocio desde D1. Sin conexión muestra el historial disponible en el dispositivo y avisa cuando puede estar incompleto. Las ventas se agrupan por fecha de cobro en la zona horaria del negocio; las propinas se muestran por separado.

## Telegram

Se usa el Worker de K-POS existente. Cada negocio vincula sus chats mediante un código temporal. Los avisos incluyen cada venta cobrada (usuario, total, medios de pago y propina), cortes y alertas de inventario bajo. Ajustes → Telegram permite activar o desactivar cada tipo y elegir horarios de resúmenes. Los resúmenes incluyen cuentas abiertas e inventario. Los avisos salen después de sincronizar; un cobro offline llega al reconectarse.

Las entregas se guardan por evento y chat. Si Telegram rechaza un envío, queda pendiente con reintentos; el cron revisa cada cinco minutos. Una sincronización repetida no crea otra entrega. Como Telegram no admite clave de idempotencia para sendMessage, una respuesta de red perdida después de aceptar el mensaje puede producir un duplicado al reintentar.

### Conectar el bot (proveedor)

1. Crear un bot con [BotFather](https://t.me/BotFather) o usar el bot existente. No pegar el token en mensajes ni guardarlo en Git.
2. En un archivo JSON privado fuera del repositorio, guardar únicamente `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET`. El segundo debe ser un secreto aleatorio de 16–256 caracteres admitidos por Telegram.
3. Desde la carpeta K-POS, ejecutar `node scripts/configure-telegram.mjs /ruta/privada/telegram.json`. El script valida el bot, guarda los dos secretos en Cloudflare y configura el webhook y comandos sin imprimir el token. Requiere la sesión de Wrangler del proveedor.
4. Agregar el bot al grupo. En el POS del negocio, Ajustes → Telegram → Generar código. Enviar `/vincular CODIGO` en el grupo y probar “Enviar resumen de hoy”.

Como alternativa, se pueden crear los dos secretos en la configuración del Worker y activar `/api/admin/telegram-setup` con la sesión del superadministrador. Se requiere el secreto de webhook para aceptar mensajes entrantes. La variable pública `TELEGRAM_BOT_USERNAME` es opcional y sirve para mostrar el enlace al bot.

Referencias: [Telegram Bot API](https://core.telegram.org/bots/api), [secretos de Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/secrets/).

## Verificación

`npm test` cubre combinaciones, consumo, periodos, sucursales, migración y reintentos de Telegram. `node --no-warnings test/e2e-combinations.mjs` crea un servidor en memoria en el puerto 8791 y comprueba el flujo completo de venta con combinación, comanda, stock, cobro y resultados en computadora y celular. No modifica clientes reales.
