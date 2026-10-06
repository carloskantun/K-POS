# Soporte del proveedor y giros

## Controles por cliente en el panel

- **Usuarios y dispositivos:** usuarios registrados, rol, habilitación, usuario reportado por cada dispositivo, última actividad y última sincronización. Actualiza automáticamente cada 15 segundos o con el botón Actualizar actividad.
- **Contraseña:** cambia la contraseña de acceso del dueño, con confirmación. No cambia los PIN de empleados ni la clave del superadministrador. Permite revocar las conexiones existentes al cambiarla.
- **Ver POS:** abre una consulta de solo lectura del catálogo, últimas 100 cuentas sincronizadas, mesas, inventario, usuarios y funciones. No permite vender ni modificar datos y no crea una sesión del dueño. Requiere la sesión del superadministrador y no devuelve contraseñas, hashes de PIN ni tokens de dispositivos.
- **Editar → Giro y funciones:** muestra y permite cambiar las funciones recomendadas para el giro, independientemente del texto del paquete comercial.

## Actividad reportada

El POS envía el usuario seleccionado al entrar, al salir y cada 30 segundos mientras tiene conexión. El panel marca actividad reciente durante 90 segundos desde el último aviso. No es una prueba de que la persona esté frente al equipo: una pestaña suspendida o la falta de internet pueden detener los avisos. Una computadora apagada pierde el indicador de actividad reciente cuando vence ese plazo.

Se reporta por dispositivo, no por cada pestaña del navegador. Si varias pestañas usan la misma conexión de dispositivo, el panel muestra el último usuario reportado. La información describe actividad del dispositivo y no sustituye una auditoría de autenticación individual del empleado.

Revocar conexión bloquea las API de ese dispositivo. No elimina su información local ni impide que la PWA opere sin conexión con datos previamente descargados. Para volver a sincronizar, debe conectarse nuevamente. Las conexiones WebSocket pueden durar hasta que se cierre o renueve la conexión; no conceden acceso a nuevas consultas o escrituras después de revocar el token.

## Funciones por giro

| Giro | Funciones recomendadas adicionales |
|---|---|
| Restaurante / Bar / Rock Alitas | Mesas, comandas, meseros, recetas e insumos |
| Taquería | Comandas, meseros, recetas e insumos |
| Frutería / Verdulería | Venta a granel |
| Mayoreo | Código de barras y precios de mayoreo |

Consulta todos los giros disponibles directamente en Editar. Ventas, inventario, caja y reportes son funciones comunes; el rol del empleado determina a cuáles puede acceder.

Al cambiar el giro, los interruptores se ajustan a las recomendaciones del giro elegido; puedes personalizarlos antes de guardar. Cambia el comportamiento y las opciones del POS. Conserva productos, precios, unidades, recetas, usuarios, mesas existentes y ventas; no carga otro catálogo ni crea mesas automáticamente. Si se cambia a restaurante desde un negocio sin mesas, hay que agregarlas en Ajustes → Mesas. Cambiar de giro no convierte las unidades de los productos existentes en kilogramos.

Desactivar una función conserva sus datos. Si una pantalla deja de estar disponible, el POS vuelve a una pantalla permitida al recibir el cambio. Los usuarios existentes no se borran ni se deshabilitan al cambiar de giro.
