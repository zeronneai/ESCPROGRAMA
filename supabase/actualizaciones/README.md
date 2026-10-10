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

El ajuste del costo de envio al cliente y de la nota "Precios sin IVA" **no agrega archivos nuevos**: usa las mismas columnas de `quote_pdf_data` (monto y moneda) y deriva el modo del monto.

Si una ejecucion falla, **no sigas con la siguiente**: copia el mensaje de error y mandamelo.
