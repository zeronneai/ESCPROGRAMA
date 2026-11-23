-- =============================================================================
-- 0069_rol_aux_finanzas.sql   (correlo SOLO, en su propia ejecucion, antes de 0070)
-- Agrega el puesto Auxiliar de administracion y finanzas (recibe las facturas fisicas pagadas).
-- =============================================================================
alter type public.user_role add value if not exists 'aux_finanzas';
