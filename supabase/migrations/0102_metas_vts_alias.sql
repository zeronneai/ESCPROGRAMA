-- =============================================================================
-- 0102_metas_vts_alias.sql   (requiere 0100)
-- En las facturas, el vendedor de VTS viene como "VENTAS CD. JUAREZ": esas cuentan para VTS Cd Juarez.
-- (Tambien sigue contando si alguna dice "VTS CD JUAREZ", porque es el nombre de la meta.)
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;
update public.metas_venta set alias_factura = 'VENTAS CD. JUAREZ', estado = 'activa'
 where public.nombre_norm(nombre) in ('VTS CD JUAREZ', 'VTS CIUDAD JUAREZ');
commit;
