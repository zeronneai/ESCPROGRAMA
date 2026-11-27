-- =============================================================================
-- 0100_metas_vts.sql   (requiere 0086)
-- VTS CD JUAREZ IGUAL QUE CASA LOCAL
--  * Las facturas que en "Vendedor" dicen VTS CD JUAREZ cuentan para la meta de VTS Cd Juarez (no para
--    quien las subio) y para el equipo. Sale en las graficas junto a Casa Local.
--  * Solo cambia la grafica de metas: pagos, comisiones, recepcion y lo demas sigue con quien la subio.
--  * La meta de VTS la puede cambiar la jefa en "Configurar metas".
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

update public.metas_venta set estado = 'activa', alias_factura = coalesce(alias_factura, 'VTS CD JUAREZ')
 where public.nombre_norm(nombre) in ('VTS CD JUAREZ', 'VTS CIUDAD JUAREZ');

insert into public.metas_venta (nombre, meta, estado, alias_factura, orden)
select 'VTS Cd Juarez', 486150, 'activa', 'VTS CD JUAREZ', 10
 where not exists (select 1 from public.metas_venta where public.nombre_norm(nombre) in ('VTS CD JUAREZ', 'VTS CIUDAD JUAREZ'));

commit;
