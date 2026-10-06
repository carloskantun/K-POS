# Mercado Pago Point en K-POS

Estado al 6 de octubre de 2026: K-POS está publicado; la integración de cobros con Mercado Pago todavía no está implementada ni conectada. “Tarjeta” registra un cobro realizado por separado.

## Crear la aplicación

1. Entra con tu cuenta a [Tus integraciones](https://www.mercadopago.com.mx/developers/panel/app).
2. Crea una aplicación llamada **K-POS** para pagos presenciales con **Mercado Pago Point**. Usa como sitio de referencia `https://k-pos.carloskantun.workers.dev` si el formulario solicita la dirección.
3. En Datos de integración → Pruebas → Credenciales de prueba, obtén el Access Token de prueba. No lo publiques, no lo incluyas en el repositorio ni lo pegues en conversaciones.
4. Después de implementar el backend de pagos, se configurarán su webhook público y, para conectar otros vendedores, su URL de retorno OAuth. Estas rutas aún no existen: no registrar direcciones inventadas como si estuvieran funcionando.

[Guía oficial para crear la aplicación](https://www.mercadopago.com.mx/developers/es/docs/mp-point/create-application).

## Cómo funcionará

Cada negocio autorizará a K-POS a usar **su propia cuenta** mediante OAuth. K-POS guardará sus credenciales en el servidor, fuera de las tablas sincronizadas a los dispositivos, y asociará la terminal a la sucursal/caja. El dinero de cada cobro se recibirá en la cuenta del vendedor conectado.

Al cobrar, K-POS enviará el importe a la terminal mediante la Orders API. La cuenta permanecerá pendiente hasta confirmar el resultado con Mercado Pago. Un webhook autenticado y una consulta al proveedor permitirán registrar el pago una sola vez. Rechazos, cancelaciones y errores de conexión no deben marcar una venta como pagada. Una demora o timeout tampoco significa que el pago haya fallado: primero se consultará la misma orden, evitando crear otra que cobre dos veces.

Se requiere conexión a internet para autorizar pagos con Mercado Pago. Las ventas locales y la sincronización diferida son independientes de esa autorización.

[Procesamiento Point](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing) · [OAuth](https://www.mercadopago.com.mx/developers/es/reference/authentication/oauth/overview).

## Pruebas antes de usar tarjetas reales

La primera prueba puede usar una terminal virtual `NEWLAND_N950__SBX0000001`, con credenciales de prueba, y simular aprobación, rechazo y cancelación. Mercado Pago documenta que las cuentas de prueba no procesan pagos reales en la terminal física.

La Smart Point 2 será útil para validar después el flujo físico. Antes se comprobará el modelo, software y modo integrado siguiendo la documentación actual de Mercado Pago. La terminal de Rock Alitas se verificará por separado; no es necesario conocer su modelo para publicar K-POS o comenzar las simulaciones.

[Pruebas oficiales](https://www.mercadopago.com.mx/developers/es/docs/mp-point/integration-test) · [Configurar terminal](https://www.mercadopago.com.mx/developers/es/docs/mp-point/configure-terminal).

## Implementación pendiente

- Conectar/desconectar cuentas por negocio con OAuth y renovación de tokens.
- Credenciales de prueba aisladas del entorno productivo; protección de tokens en servidor.
- Terminales por sucursal/caja y órdenes de pago con claves de idempotencia.
- Verificación de webhooks, consulta de estado y conciliación de importe, moneda, vendedor y cuenta POS.
- Pantalla de cobro pendiente/aprobado/rechazado y recuperación tras cerrar o reconectar el dispositivo.
- Pruebas de duplicados, cancelación, notificaciones atrasadas y aislamiento entre clientes.

El negocio `pruebas-kpos` está disponible para esta etapa. Sus datos son ejemplos, sin ventas reales ni existencias iniciales inventadas.
