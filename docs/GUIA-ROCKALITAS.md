# Arranque en Rockalitas (bar de rock y restaurante-bar)

Lista para dejar operando el piloto. Tiempo estimado: una tarde, antes de abrir.

## Qué se necesita en el local

| Puesto | Dispositivo | Modo en K-POS |
|---|---|---|
| Caja / barra principal | Tablet o laptop | Punto de venta (cobra, abre y cierra caja) |
| Cada mesero | Su celular (Android o iPhone) | Punto de venta con usuario **Mesero** |
| Barra (bartender) | Tablet o celular | **Pantalla de cocina**, filtro *Barra* |
| Cocina | Tablet | **Pantalla de cocina**, filtro *Cocina* |
| Impresora de comandas (opcional) | Térmica 58/80 mm Bluetooth o USB | En el dispositivo de barra/cocina: *Imprimir comandas que lleguen* |
| Dueño | Su celular + Telegram | Reportes diarios y avisos |

Internet del local: recomendable. Si se cae, **todos siguen vendiendo**; las comandas entre dispositivos se
retoman solas al volver la conexión. Si el bar quiere comandas sin internet, se puede poner el servidor local
(`docs/ARQUITECTURA.md`, punto 4).

## Paso a paso

1. **Crear el negocio** en la tablet de caja: *Crear mi negocio → Bar / Restaurante-bar*, con cuenta en la nube
   (cuenta: `rockalitas`, correo y contraseña del dueño). Queda precargado un menú de ejemplo con cervezas,
   cubetas por marca, micheladas, cocteles, alitas con salsas, hamburguesa con término y cover.
2. **Menú real**: *Ajustes → Productos*. Opciones:
   - Editar uno por uno (foto con la cámara, precio, extras).
   - O llenar el menú en Excel, guardarlo como CSV y usar **⬆ Importar**. Primero descarga **⬇ CSV** para ver
     el formato (columnas: nombre, categoria, precio, costo, unidad, codigo_barras, emoji, estacion, inventario,
     stock_minimo, existencia, en_venta, precio_mayoreo, mayoreo_desde).
3. **Extras y variantes** (en cada producto, sección *Extras y variantes*):
   - *Obligatorio* + *Máx. 1* = elegir uno (término de la carne, marca de la cubeta).
   - *Máx. 2* = hasta dos (dos salsas de alitas).
   - Precio extra por opción (Clamato +$10, tocino +$25).
   - "Descuenta del inventario": la cubeta de Victoria resta 6 Victorias; la michelada resta 1 cerveza de la marca elegida.
4. **Estación** de cada producto: *barra* (bebidas preparadas) o *cocina* (comida). Las cervezas en botella no
   llevan estación: se entregan directo y solo descuentan inventario.
5. **Inventario inicial**: *Inventario → Conteo rápido*, escribir lo que hay de cada cerveza, refresco, etc.
   Ajustar el *stock mínimo* para recibir alertas en Telegram.
6. **Mesas**: *Ajustes → Mesas* (el preset trae 12). Usa *zona* para agrupar: Terraza, Salón, Barra.
7. **Usuarios**: *Ajustes → Usuarios*. Un usuario por mesero con su PIN; el encargado con rol **Encargado**
   (es quien autoriza cancelaciones y descuentos con su PIN); bartender y cocina con rol **Cocina / Barra**.
   Activa o no *Los meseros pueden cobrar* en *Ajustes → Negocio*.
8. **Conectar dispositivos**: en la tablet de caja *Ajustes → Dispositivos → Generar código*. En cada celular o
   tablet abrir la dirección de K-POS → *Conectar este dispositivo* → cuenta `rockalitas` + código.
   Después **instalar la app**: iPhone/iPad *Compartir → Agregar a inicio*; Android *menú ⋮ → Instalar app*.
9. **Barra y cocina**: en esos dispositivos *Ajustes → Dispositivos → Modo: Pantalla de cocina* y elegir el filtro.
   Si hay impresora: *Impresora de este dispositivo* → conectar → *Imprimir comandas que lleguen* → *Imprimir prueba*.
10. **Telegram**: *Ajustes → Telegram → Generar código*, agregar el bot al grupo de los socios y mandar
    `/vincular CÓDIGO`. Elegir hora del resumen diario (ej. 11:00, después del cierre) y avisos de "cómo va"
    (ej. 22:00 y 01:00).
11. **Ticket**: *Ajustes → Negocio → Encabezado del ticket* (dirección, teléfono, RFC) y pie del ticket.

## Operación diaria

- **Abrir caja** con el fondo al iniciar el turno.
- Mesero: *Mesas → Mesa 5 →* toca fotos → *Enviar comanda*. Cuando barra/cocina marca listo, la mesa se pone verde.
- Cuenta de barra sin mesa: *Cuentas → Nueva cuenta* con el nombre del cliente.
- **Dividir cuenta**: menú ⋯ de la cuenta → *Dividir cuenta / pasar productos*. **Unir mesas**: *Cambiar o unir mesa*.
- **Cobrar**: pago mixto (*Agregar pago*), *÷ Entre personas*, propina 10/15/20 %, efectivo con cambio.
- **Cancelar** algo ya enviado pide el PIN del encargado y queda en la bitácora (se ve en Reportes y en Telegram).
- **Cerrar caja** con el conteo por billetes; el corte llega a Telegram con sobrante o faltante.
- Propinas en efectivo quedan en el cajón hasta repartirlas: regístralo como *Salida* ("reparto de propinas").

## Qué revisar al final de la primera semana

- Cancelaciones y descuentos por usuario (Reportes → Cancelaciones y descuentos).
- Diferencias en cortes de caja.
- Productos con inventario que no cuadra contra el conteo físico (Inventario → Movimientos).
- Qué pidió el equipo que no existe todavía → siguiente iteración.
