-- =============================================================================
-- 0006_estados_nuevos.sql
-- Que hace: agrega dos estados de partida: "actualizacion_solicitada" (el vendedor pidio
--           revisar una cotizacion con vigencia vencida) y "esperando_aclaracion" (el reloj
--           de 48 horas habiles esta en pausa hasta que el vendedor responda).
-- Como aplicarlo: pega este archivo COMPLETO en Supabase > SQL Editor y presiona Run,
--           en UNA sola ejecucion y SOLA (no la juntes con otro archivo: Postgres no deja usar
--           un valor de enum nuevo en la misma ejecucion en que se crea).
-- Depende de: instalar-todo.sql (0001 a 0005).
-- =============================================================================

alter type public.item_status add value if not exists 'actualizacion_solicitada';
alter type public.item_status add value if not exists 'esperando_aclaracion';

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva, debe devolver 6 filas):
--   select enumlabel from pg_enum
--    where enumtypid = 'public.item_status'::regtype order by enumsortorder;
--   -- pendiente, cotizada, no_encontrada, enviada_cliente, actualizacion_solicitada, esperando_aclaracion
--   -- (son 6 valores; los dos ultimos son los nuevos)
-- -----------------------------------------------------------------------------
