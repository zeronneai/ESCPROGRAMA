# Actualizaciones de base de datos

`supabase/instalar-todo.sql` esta **congelado**: es lo que ya se instalo en Supabase. No se vuelve a editar ni a pegar.

Cualquier cambio posterior de base de datos se entrega asi:

1. Una migracion nueva y numerada en `supabase/migrations/` (`0006_...sql`, `0007_...sql`, ...).
2. El mismo cambio, solo ese, en este directorio con el mismo nombre, para pegarlo en el SQL Editor sin reinstalar.

Se pegan **en orden numerico**, **un archivo por ejecucion** (pega el archivo completo, presiona Run, espera el "Success" y recien entonces pasa al siguiente), una sola vez cada uno. Cada archivo trae al inicio su encabezado y al final una consulta de VERIFICACION en comentarios que puedes pegar para confirmar que se aplico bien.

Una prueba automatica (`tests/unit/migrations.test.ts`) verifica que las migraciones ya instaladas no cambien y que cada migracion nueva tenga su copia identica aqui.

## Pendientes de pegar (fase 4)

| Orden | Archivo | Que agrega |
|---|---|---|
| 1 | `0006_estados_nuevos.sql` | Dos estados de partida. **Va sola**, en su propia ejecucion. |
| 2 | `0007_vigencia_revisiones.sql` | Vigencia de 15 dias, versiones de cotizacion, solicitudes de actualizacion. Respalda `valid_until` de lo existente dentro de una transaccion. |
| 3 | `0008_resultados.sql` | Resultado ganada o perdida y "Solicitar actualizacion". |
| 4 | `0009_historial_proveedores.sql` | Historial de precios (pg_trgm) y catalogo de proveedores. |
| 5 | `0010_aclaraciones.sql` | Mini chat por partida, pausa del reloj y bucket `aclaraciones`. |
| 6 | `0011_pdf_y_cliente.sql` | Datos del PDF, precio elegido guardado, atencion y destino. |
| 7 | `0012_abastecimiento.sql` | "Donde conseguirlo" y vista "Por comprar" (solo comprador). |
| 8 | `0013_envio_modos.sql` | Envio al cliente dentro del precio unitario (por unidad, por pedido, por partida) y leyenda de envio editable. El envio ya guardado pasa a "por todo el pedido". |
| 9 | `0014_alternativo_nombre_pdf.sql` | Producto alternativo del comprador (dentro de la version cotizada), "Nombre en el PDF" por partida y version, y busquedas que tambien consideran la descripcion/uso. |
| 10 | `0015_compra_minima.sql` | Compra minima obligatoria (cantidad y unidad) en cada cotizacion nueva, y la decision del vendedor cuando la cantidad pedida es menor al minimo. No modifica cotizaciones ya bloqueadas. |
| 11 | `0016_leads.sql` | Módulo de **Leads** para vendedores: prospectos, bitácora de contactos (llamada, WhatsApp, correo, visita), etapas, conversión a cliente y entrada desde el sitio web. Solo agrega tablas nuevas; no toca nada existente. |
| 12 | `0017_envio_cliente_recotizar.sql` | Registro de envío al cliente con número de cotización y copia fija del PDF, recotización con número nuevo (-V2, -V3), envío sin cargo / incluido / aparte / mixto, y base general de clientes (RFC, dirección y contacto obligatorios para enviar solicitudes nuevas). No modifica cotizaciones ya enviadas. |
| 13 | `0018_rol_jefe_ventas.sql` | Agrega el rol **Jefa de ventas**. Córrelo **solo** (una línea, en su propia ejecución) antes del 14. |
| 14 | `0019_bitacora_clientes.sql` | **Bitácora de ventas / Prospección** (formato ESC-VEN-FR-002) por etapas, clientes marcados como Cliente o Prospecto con registro de conversión, privacidad (el vendedor ya no ve la lista completa de clientes, solo los busca) y permisos de la Jefa de ventas. Copia los leads existentes a Prospección. |
| 15 | `0020_roles_calidad.sql` | Agrega los puestos **Gerente**, **Coordinador ISO** y **Marketplaces**. Córrelo **solo**, en su propia ejecución, antes del 16. |
| 16 | `0021_calidad_consumo_guias.sql` | **Quejas de cliente** (ESC-SGC-FR-002), **acciones correctivas** (ESC-SGC-FR-001), **consumo interno** con aprobación de la jefa de ventas y **guías de paquetería** con Marketplaces, recordatorio a las 4 horas y alerta a las 24. |
| 17 | `0022_articulos.sql` | **Catálogo de artículos** (987 del sistema de ESC: 695 activos, 5 sin compras pero con existencia, 154 suspendidos y 133 bajas). En la bitácora solo se eligen los activos y los que aún tienen existencia. |
| 18 | `0023_demo.sql` | **Demostración**: el comprador activa ejemplos por sección desde Configuración. |
| 19 | `0024_ventas_diarias.sql` | **Ventas diarias** separadas de la **Prospección**: registro sencillo por venta (cliente, artículos, pedido, factura, monto, contado o crédito, entrega y cobranza) con cartera vencida calculada sola. Paqueterías de guías: Paquete Express, Estafeta, Tinypack, Porteo, DHL u Otra. |
| 20 | `0025_rol_almacen.sql` | Agrega el puesto **Almacén**. Córrelo **solo**, en su propia ejecución, antes del 21. |
| 21 | `0026_evaluaciones.sql` | **Proveedores** con datos completos, **evaluación de proveedores** (comprador + almacén, escala 1 a 5) y **evaluación de clientes** (link único por cliente, 3 respuestas). Dos veces al año: la siguiente se activa sola a los 6 meses. |
| 22 | `0027_roles_supervisores.sql` | Agrega los puestos **Supervisor de almacén** y **Supervisor de finanzas**. Córrelo **solo**, en su propia ejecución, antes del 23. |
| 23 | `0028_sucursales_visitas_minutas.sql` | **Sucursales** de clientes (otra dirección con título, cuenta como cliente aparte), **visita sin venta** con motivo, guías en **bultos o tarima**, **encuesta de satisfacción** ESC-VEN-FR-002 (10 preguntas, 4 respuestas, puesto de quien contesta) activa hasta el 1 de marzo de 2027, botón para **quitar la demostración** y **minutas de reunión** con firmas. |
| 24 | `0029_documentos_control_cambios.sql` | **Documentos** (el Coordinador ISO sube los PDF con código, título, categoría y versión; todos los consultan; versiones anteriores en historial) y **control de cambios** (lo llena el Coordinador ISO; la gerente y el comprador lo consultan y reciben aviso). |
| 25 | `0030_rol_ceo.sql` | Agrega el puesto **CEO**. Córrelo **solo**, en su propia ejecución, antes del 26. |
| 26 | `0031_pagos_extranjeros.sql` | **Pagos a proveedores extranjeros**: el comprador registra OC con sus facturas o anticipos y las libera; el CEO marca pagado y sube el comprobante; al descargarlo el comprador pasa al historial. |
| 27 | `0032_pagos_seguimiento.sql` | Pagos: el CEO paga en cuanto hay factura; "carga liberada" pasa a ser seguimiento de la importación; botón **Urgente** y **comentario para el CEO**. |
| 28 | `0033_ceo_lectura.sql` | El **CEO** ve todo lo que ve la gerente (sin editar), además de Pagos. |
| 29 | `0034_folio_sac.sql` | Folio seriado de acciones correctivas: **SAC-01, SAC-02...** (renumera las existentes en orden). |
| 30 | `0035_almacen_inventario.sql` | **Almacén con trazabilidad**: recepciones con etiquetas QR (1 etiqueta = 1 pieza en inventario), facturas que sube ventas para cargar, y escaneo al cargar el camión que rechaza lo que no viene en la factura. |
| 31 | `0036_folio_factura_unico.sql` | Entregas: una factura (folio) **solo se puede subir una vez**, aunque se escriba con guion o espacios. El portal avisa en cuanto se lee el PDF. |
| 32 | `0037_recepcion_fecha_hoy.sql` | Recepciones: la fecha queda **bloqueada al día en que se registra** (no se puede cambiar). |
| 33 | `0038_venta_desde_factura.sql` | **Venta con factura**: el vendedor sube el PDF y se registra la venta, el cliente (alta o datos que falten) y la entrega a almacén. Almacén ya no cierra con faltantes: **En espera por falta de material**. |
| 34 | `0039_guias_alarma_2h.sql` | Guías: el vendedor puede recordar a Marketplaces desde la **1 hora** (antes 4). Alarma a la hora y rojo fuerte a las 2 horas. |
| 35 | `0040_tiempo_real.sql` | **Tiempo real**: las pantallas se actualizan solas cuando alguien sube una factura, pide una guía, cotiza, paga, etc. (sin recargar). |
| 36 | `0041_pagos_documentos_office.sql` | Pagos: se pueden adjuntar proformas y facturas del proveedor en **Excel y Word** (además de PDF e imagen). |

Opcional: `supabase/borrar-datos-de-prueba.sql` borra solicitudes, clientes, bitácora, quejas, guías, etc. para empezar en limpio. Conserva usuarios, configuración, tabulador y proveedores. No se puede deshacer.

Si una ejecucion falla, **no sigas con la siguiente**: copia el mensaje de error y mandamelo.
