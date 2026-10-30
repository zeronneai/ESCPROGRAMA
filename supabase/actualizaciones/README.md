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

Si una ejecucion falla, **no sigas con la siguiente**: copia el mensaje de error y mandamelo.
