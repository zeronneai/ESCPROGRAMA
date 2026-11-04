-- =============================================================================
-- 0030_rol_ceo.sql   (correlo SOLO, en su propia ejecucion, antes de 0031)
-- Agrega el puesto CEO (paga a los proveedores extranjeros).
-- =============================================================================
alter type public.user_role add value if not exists 'ceo';
