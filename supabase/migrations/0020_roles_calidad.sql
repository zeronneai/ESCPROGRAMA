-- =============================================================================
-- 0020_roles_calidad.sql   (correlo SOLO, en su propia ejecucion, antes de 0021)
-- Agrega los puestos: Gerente (ve casi todo, sin editar), Coordinador ISO (quejas y acciones
-- correctivas) y Marketplaces (genera las guias de paqueteria).
-- Postgres no deja usar un valor nuevo de un tipo en la misma ejecucion en que se crea; por eso va aparte.
-- =============================================================================
alter type public.user_role add value if not exists 'gerente';
alter type public.user_role add value if not exists 'coordinador_iso';
alter type public.user_role add value if not exists 'marketplaces';
