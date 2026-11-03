-- =============================================================================
-- 0027_roles_supervisores.sql   (correlo SOLO, en su propia ejecucion, antes de 0028)
-- Agrega los puestos Supervisor de almacen y Supervisor de finanzas (jefes de departamento que hacen minutas).
-- =============================================================================
alter type public.user_role add value if not exists 'supervisor_almacen';
alter type public.user_role add value if not exists 'supervisor_finanzas';
