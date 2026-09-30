# K-POS: revisión de interfaz y alta de clientes

Revisión del 30 de septiembre de 2026 con ui-ux-pro-max, aplicada a HTML/CSS/JavaScript nativo. K-POS es un producto para varios negocios; Rock Alitas es una plantilla opcional de piloto.

## Evaluación y cambios

| Área | Lo que funcionaba | Problema observado | Cambio aplicado |
|---|---|---|---|
| Clientes | Planes, suspensión y códigos de soporte | No había alta ni regreso al POS | Nuevo cliente, búsqueda, filtro por estado y Volver al POS |
| Pruebas y clientes oficiales | Roles y datos por negocio | Catálogo Rock Alitas visible para cualquier giro | Plantilla opcional; catálogo vacío por defecto al dar de alta un cliente; panel Rock Alitas solo en negocios que lo usan |
| Productos | Tarjetas grandes para vender | Nombres recortados y el mismo emoji de plato para comida distinta | Nombres completos, imágenes SVG de referencia por producto y prioridad a fotos cargadas por el negocio |
| Navegación móvil | Acceso a los módulos por rol | Siete botones comprimidos en la barra | Hasta cuatro destinos principales y Más; iconos SVG con texto |
| Notificaciones | Confirmación al guardar | Avisos tapaban encabezados | Avisos en la parte inferior |
| Formularios | Validación básica | Etiquetas sin relación con campos y poca información al crear un cliente | Campos etiquetados, error visible, estado Creando, datos comerciales opcionales |
| Ventanas | Cancelar y cerrar | Sin título accesible ni retorno del foco | Título asociado, tabulación dentro de la ventana y retorno del foco al cerrar |
| Color | Fondo claro y acciones diferenciadas | Algunos botones y metadatos tenían contraste bajo | Verde, naranja y textos secundarios más oscuros; selección de categoría uniforme |

## Alta desde superadministración

1. Abrir `/admin.html` y entrar con la clave de superadministrador.
2. Nuevo cliente: capturar negocio, dueño, cuenta, giro, correo, contraseña y PIN.
3. Elegir **Activo** para un cliente oficial o **Prueba** para un piloto.
4. Elegir catálogo vacío, ejemplo del giro o Rock Alitas (bar/restaurante).
5. Crear cliente. El sistema guarda el negocio, el dueño y el catálogo como una sola operación.
6. En el dispositivo del dueño: Conectar este dispositivo → Usar correo y contraseña del dueño. Luego entrar con el PIN.

El alta no crea ventas, no asigna existencias ficticias ni envía correos. El acceso local de prueba y el acceso publicado usan servidores diferentes: un cliente creado en localhost no se traslada automáticamente a Cloudflare. Para Rock Alitas local, conectar el negocio existente a la nube desde Ajustes → Negocio conserva su catálogo local.

## Imágenes

Las ilustraciones incluidas son referencias genéricas, no fotografías de los platos de Rock Alitas. En Ajustes → Productos → Foto se puede cargar la fotografía real; esta tiene prioridad sobre la ilustración. Las ilustraciones se guardan con la app para abrir sin internet. La disponibilidad, el tamaño de las porciones y los ingredientes deben corresponder al catálogo del negocio.

## Validación

- Pruebas de API: autorización, validación, cuentas repetidas, entrada del dueño, separación de clientes y reversión completa si falla la carga inicial.
- Prueba de navegador: alta, búsqueda/filtros, regreso, entrada por contraseña/PIN, 48 productos, Más y nombres completos en móvil.
- Revisión visual de capturas en móvil y escritorio.

El panel de Rock Alitas también se conserva en negocios que ya importaron sus productos antes de esta actualización.

La interfaz es de tema claro. Fotografías reales y presencia de usuarios en tiempo real siguen pendientes; los dispositivos registrados no equivalen a usuarios activos.

## Referencias técnicas

El alta utiliza el lote transaccional de [D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch): si falla una sentencia, se revierte el conjunto. Agrupa filas por tabla para reducir consultas y respetar los [límites de D1](https://developers.cloudflare.com/d1/platform/limits/).
