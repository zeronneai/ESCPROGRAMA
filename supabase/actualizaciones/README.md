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
| 37 | `0042_pagos_parciales.sql` | Pagos: el CEO puede **pagar en partes** (anticipo). Lo que no paga queda como saldo Por pagar en un renglón nuevo. |
| 38 | `0043_proforma_oc_anticipos.sql` | Pagos: la **proforma** queda como documento de referencia de la OC (se reemplaza o quita; no se paga ni se suma). Las facturas reales **descuentan el anticipo** ya pagado y el CEO paga solo lo neto. |
| 39 | `0044_analisis_riesgo.sql` | **Análisis y evaluación de riesgo** (formato de calidad) para los jefes de área: varios modos de falla por actividad, S/O/D con criterios, ROE automático, tratamiento y riesgo residual. |
| 40 | `0045_quejas_link_dictamen.sql` | **Link de quejas para clientes** (`/quejas`, sin cuenta, para tarjetas y firmas de correo) y botón **Sí aplica / No aplica** del coordinador ISO: hasta que aplica, la queja queda bloqueada. |
| 41 | `0046_firma_correo.sql` | **Firma de correo**: cada usuario llena sus datos y descarga la imagen con la leyenda y el link de quejas. A vendedores y jefa de ventas les aparece sola al entrar. |
| 42 | `0047_almacen_conectado.sql` | Interruptor **"Almacén conectado a ventas"** en Configuración (viene apagado): la venta con factura ya no manda carga a almacén y se esconden Entregas e Inventario hasta que esté el inventario. |
| 43 | `0048_demo_quitar_where.sql` | Arregla **Quitar demostración** ("DELETE requires a WHERE clause"). Se puede correr en cualquier momento. |
| 44 | `0049_guias_partidas.sql` | **Guías con partidas**: varias tarimas o bultos distintos en un mismo envío, cada uno con su peso y medidas. Se puede correr en cualquier momento. |
| 45 | `0050_entrega_sucursal_guias.sql` | Venta con factura: el **domicilio de entrega** se registra como **sucursal** del cliente. Guías: el vendedor ve el número de guía pero **no descarga el archivo**. |
| 46 | `0051_guias_moneda.sql` | Guías: **moneda del valor declarado** (MXN o USD); si la factura es en dólares se llena en USD. Se puede correr en cualquier momento. |
| 47 | `0052_cotizaciones_foto_guias_palomeo.sql` | Solicitudes: **imagen o link opcional**. **Imagen de confirmación** del comprador por partida (el vendedor la descarga). Guías: Marketplaces **palomea cada partida**. |
| 48 | `0053_catalogo_aviso_pegatron.sql` | **Catálogo 2026**: aviso a todos y comentarios para el comprador. **Pedidos Pegatron**: la jefa de ventas sube la OC y pone el artículo ESC; el comprador marca lo pedido. |
| 49 | `0054_guias_varios_archivos.sql` | Guías: Marketplaces sube **varios archivos** (uno por bulto o tarima), cada uno con su **número de guía**. |
| 50 | `0055_jefa_bitacora.sql` | La **jefa de ventas** lleva su propia **bitácora** (prospección, ventas diarias, visitas y ventas con factura) como los vendedores. |
| 51 | `0056_comprador_pide_guias.sql` | El **comprador** también puede **pedir guías** a Marketplaces y descargarlas. |
| 52 | `0057_guias_recoleccion.sql` | Guías de **recolección con proveedor**: se sube la **OC** y la guía va del proveedor (origen) a ESC (destino). |
| 53 | `0058_rfc_prospectos.sql` | A los **prospectos** ya se les cotiza **sin RFC**; el **RFC de ESC** ya no se acepta en clientes y se borra donde lo pusieron (se llena solo al subir su factura o constancia). |
| 54 | `0059_planeacion_compras.sql` | **Planeación de compras** (solo comprador): proveedores, artículos, existencia de Microsip a una fecha, historial de venta y OCs con proforma y recepción. No toca el inventario de almacén. **Después** corre `../cargas/planeacion_compras_inicial.sql` (existencia al 18/11/2026, historial y OCs de tu Excel). |
| 55 | `0060_oc_formato_gerente_cotizaciones.sql` | **Purchase Order** con el formato de ESC (razón social, AT'N y Ship to por proveedor) y la **gerente ve las cotizaciones** con costos y etapas, sin proveedor ni links del comprador. Si ya corriste la carga de planeación, vuelve a correrla después de esta para que se llenen el MODEL y el PRODUCT en inglés. |
| 56 | `0061_planeacion_stock_suficiente.sql` | Planeación: la venta real también cuenta como desabasto los días en que la existencia **no alcanzaba para un pedido normal** (no solo los días en cero). Después vuelve a correr `../cargas/planeacion_compras_inicial.sql`. |
| 57 | `0062_guias_recoleccion_ocurre.sql` | Guías de los vendedores: eligen **Recolección u Ocurre** y Marketplaces lo ve en grande. |
| 58 | `0063_cotizar_sin_esperar_aclaracion.sql` | El comprador puede **cotizar aunque esté pendiente una aclaración**: se cierra la pausa y el vendedor todavía puede contestar. |
| 59 | `0064_pegatron_linea_sobrepedido.sql` | Pedidos Pegatron en dos secciones: **de línea** (importación, entra a planeación de compras) y **sobrepedido** (locales o no comunes), con recuento por artículo. |
| 60 | `0065_prospeccion_pausa_jefa_factura.sql` | **Pausa en la prospección** (no cuenta como atrasado) y **la jefa sube facturas a nombre de un vendedor** (vacaciones, etc.). |
| 61 | `0066_prospecto_a_cliente.sql` | **El prospecto que compra sale de Prospección** (aunque la venta quede en una sucursal o lo marquen cliente a mano) y queda en el historial "Se volvieron clientes". Corrige los que ya estaban así. |
| 62 | `0067_unir_prospecto_cliente.sql` | **Unir un prospecto con el cliente de su factura** cuando la factura salió con otro nombre (razón social) y se subió en Ventas diarias. Se queda con su nombre popular y toma RFC y razón social. |
| 63 | `0068_cliente_solo_con_factura.sql` | **Un prospecto pasa a cliente solo al subir el PDF de su factura** (se quitan "Ya es cliente" y "Venta cerrada"). Reabre los prospectos marcados a mano como cerrados sin ninguna venta. |
| 64 | `0069_rol_aux_finanzas.sql` | **Puesto Auxiliar de administración y finanzas.** Córrelo solo, en su propia ejecución. |
| 65 | `0070_recepcion_facturas.sql` | **Recepción de facturas pagadas**: el vendedor entrega sus facturas cobradas agrupadas por pago; finanzas las recibe, rechaza con motivo y anota. |
| 66 | `0071_tipo_cambio_ventas.sql` | **Tipo de cambio de las facturas en dólares** (solo se guarda como dato; los totales van en pesos y dólares por separado). |
| 67 | `0072_comisiones.sql` | **Comisiones por artículo**: % por artículo (obligatorio para marcar la venta pagada), y la jefa las ve por vendedor y por factura en Ventas > Comisiones. |
| 68 | `0073_fecha_pago_obligatoria.sql` | **Fecha de pago obligatoria** al marcar una venta pagada (no futura ni antes de la venta). Las ya pagadas se quedan igual. |
| 69 | `0074_comisiones_revision.sql` | **Comisiones: revisión de la jefa.** El vendedor llena las faltantes (aunque ya esté pagada); la jefa revisa; la gerente ve solo lo revisado. |
| 70 | `0075_envio_en_comision.sql` | **Envío incluido en los artículos**: se resta del importe y la comisión se calcula sobre lo que queda. |
| 71 | `0076_conciliaciones.sql` | **Conciliaciones bancarias**: finanzas sube el estado de cuenta (solo abonos); los vendedores identifican sus pagos y su factura queda pagada con la fecha del abono. |
| 72 | `0077_conciliacion_plazo.sql` | **Conciliaciones: 7 días para identificar** (después en rojo, comisión −10% y siguiente quincena); la gerente y el CEO ven e identifican a nombre de un vendedor; aviso en tiempo real. |
| 73 | `0078_pedidos_vendedores.sql` | **Pedidos de vendedores y asistente de compras**: los vendedores piden artículos del kárdex u "otro" (única, semanal, mensual, anual); las únicas se cierran solas al entrar en una OC; reglas y uso del asistente (Claude). |
| 74 | `0079_meta_prospeccion.sql` | **Meta diaria de prospección**: telemarketing 8 y campo 2 prospectos por día (lunes a viernes, acumulativa desde el 16 de noviembre); la jefa cambia metas y tipo de cada vendedor; aviso rojo y ventana diaria para el vendedor. |
| 75 | `0080_metas_ventas.sql` | **Metas mensuales de venta y ventas sin IVA**: subtotal sin IVA en cada venta (de la factura o estimado); captura manual para metas sin usuario; meta en pesos sin IVA por vendedor (Casa Local y VTS Cd Juárez en pausa, José Ortiz sin usuario); avance en % con Ventas diarias del mes en tiempo real (/metas); la jefa las cambia en Metas. |
| 76 | `0081_metas_periodo_publico.sql` | **Metas: periodo proporcional y pantalla pública**: la jefa elige desde/hasta qué día cuenta el mes (la meta se ajusta a esos días; empieza el 16 de noviembre); al cambiar de mes se toma completo solo; link sin usuario para las teles, solo porcentajes, en tiempo real. |
| 77 | `0082_tipo_cambio_pago.sql` | **Tipo de cambio del pago**: al marcar pagada una venta en dólares se pide el tipo de cambio del día del pago (propone el de Banxico); si la marca Conciliaciones se pone el de Banxico. |
| 78 | `0083_metas_periodo_comprador.sql` | **Periodo de metas también para el comprador**: puede cambiar desde/hasta qué día cuentan las metas. |
| 79 | `0084_metas_periodo_marketplaces.sql` | **Periodo de metas también para marketplaces**. |
| 80 | `0085_recepcion_gerente_prospectos_clientes.sql` | **Recepción para gerente y CEO, y prospectos que ya son clientes**: la gerente y el CEO ven Recepción de facturas por vendedor (solo consulta); la meta de prospección muestra cuántos de los registrados ya compraron. |

Opcional: `supabase/borrar-datos-de-prueba.sql` borra solicitudes, clientes, bitácora, quejas, guías, etc. para empezar en limpio. Conserva usuarios, configuración, tabulador y proveedores. No se puede deshacer.

Si una ejecucion falla, **no sigas con la siguiente**: copia el mensaje de error y mandamelo.

**Limpieza de una sola vez (no es actualización):** `../limpiezas/limpiar_prospectos_sitio_web.sql` borra los prospectos de prueba que entraron por el formulario del sitio web y las empresas que se dieron de alta solas con ellos (si no tienen nada más). `../limpiezas/revisar_actualizaciones.sql` dice cuáles de estas ya están corridas (solo consulta). `../limpiezas/limpiar_pruebas_diana.sql` borra los prospectos "Prueba Web SA" y "vgvgt" y las cotizaciones COT-2026-0001 y 0002 (SIGMA ALIMENTOS) de prueba de Diana Fierro. `../limpiezas/limpiar_pruebas_vendedores.sql` borra las ventas, solicitudes y prospectos del usuario "Prueba" y la venta de prueba de Diana Fierro (antes del 12 de noviembre).
