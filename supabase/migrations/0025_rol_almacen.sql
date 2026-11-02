-- =============================================================================
-- 0025_rol_almacen.sql   (correlo SOLO, en su propia ejecucion, antes de 0026)
-- Agrega el puesto Almacen (evalua a los proveedores en lo que recibe: estado, cantidades, empaque).
-- =============================================================================
alter type public.user_role add value if not exists 'almacen';
