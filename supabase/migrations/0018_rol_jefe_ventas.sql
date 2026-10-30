-- =============================================================================
-- 0018_rol_jefe_ventas.sql
-- Que hace: agrega el rol "jefe_ventas" (Jefa de ventas: ve el resumen por vendedor).
-- Como aplicarlo: pega este archivo SOLO, en su propia ejecucion, y presiona Run.
--   (Postgres no permite usar un valor nuevo de un tipo en la misma ejecucion en que se crea;
--    por eso va separado de 0019.)
-- =============================================================================

alter type public.user_role add value if not exists 'jefe_ventas';

-- VERIFICACION (pegala en una consulta nueva):
--   select enum_range(null::public.user_role);   -- {vendedor,comprador,jefe_ventas}
