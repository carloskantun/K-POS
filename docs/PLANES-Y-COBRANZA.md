# Planes y cobranza de K-POS

Desde el panel del proveedor, disponible en `/admin.html`:

- **Paquetes:** crear, editar o archivar paquetes, definir nombre, precio en MXN, periodicidad, descripción y servicios incluidos. No se cargan precios de ejemplo en producción.
- **Editar cliente:** modificar nombre del negocio, correo de acceso del dueño, teléfono, estado, paquete, precio acordado, servicios incluidos, inicio del servicio, fin de prueba, servicio cubierto hasta, próximo cobro previsto y notas internas.
- **Cobranza:** crear cargos de tu servicio, registrar pagos completos o parciales, consultar saldo e historial, y anular registros con motivo.
- **Filtros:** clientes con saldo pendiente o servicio vencido, además de activos, pruebas y suspendidos.

## Flujo recomendado

1. Crea un paquete con el precio y los servicios que decidas ofrecer.
2. En Rock Alitas o cualquier cliente, abre **Editar**, selecciona el paquete y pulsa **Copiar precio y servicios del paquete**. Puedes ajustar el acuerdo individual antes de guardar.
3. Define sus fechas. Las fechas del panel se interpretan en hora de Cancún.
4. Abre **Cobranza → Crear cargo** para el periodo o servicio contratado.
5. Cuando recibas dinero, pulsa **Registrar cobro**, captura el importe, la fecha, el método y la referencia. Se permiten pagos parciales hasta el saldo pendiente.
6. Actualiza **Servicio cubierto hasta** y **Próximo cobro previsto** según el acuerdo. No se modifican automáticamente al registrar el pago.

## Qué se conserva

Modificar o archivar un paquete no cambia el precio ni los servicios ya acordados con un cliente. Para cambiar un acuerdo existente, abre Editar y vuelve a copiar los valores del paquete si corresponde.

Los cobros de tu suscripción están separados de los pagos y ventas de cada negocio. Las cantidades comerciales se guardan en centavos enteros. La base evita que dos pagos concurrentes excedan el saldo del mismo cargo. Anular deja el registro y su motivo en el historial; no devuelve dinero. Para anular un cargo que tiene pagos vigentes, primero corrige esos registros.

## Alcance actual

Los servicios incluidos describen el acuerdo comercial. No constituyen límites automáticos de funciones, sucursales, usuarios o dispositivos. La periodicidad y el próximo cobro son controles manuales: no generan cargos recurrentes automáticamente. El vencimiento no suspende a un cliente por sí solo.

Este panel no ejecuta cargos bancarios, emite facturas fiscales ni efectúa reembolsos. La integración de Mercado Pago sigue pendiente y tendrá un flujo separado de confirmación por proveedor.

El menú, precios de los productos, recetas, existencias y usuarios se editan dentro del POS del negocio. Cambiar el nombre del cliente en superadministración sí actualiza el nombre del negocio sincronizado en el POS. Cambiar el correo del dueño cambia el correo requerido para conectar dispositivos; conserva su contraseña actual. La cuenta (`slug`) permanece estable.
