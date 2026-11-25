-- =============================================================================
-- revisar_ventas_vendedor.sql   (solo consulta, no cambia nada)
-- Para comparar contra Microsip: las facturas que una vendedora tiene en Ventas diarias en un rango.
-- 1) Cambia el nombre y las fechas en la linea "params" de abajo.
-- 2) Pega todo en SQL Editor y presiona Run. Sale una lista por factura y al final los totales.
-- =============================================================================
with params as (
  select 'Alejandra Rangel'::text as vendedora, date '2026-11-01' as desde, public.local_today() as hasta
), v as (
  select x.fecha, x.factura, c.nombre as cliente, x.moneda,
    x.monto as total_con_iva, x.subtotal as sin_iva, x.subtotal_estimado as sin_iva_calculado,
    x.tipo_cambio,
    round(case when x.moneda = 'USD' then x.subtotal * coalesce(x.tipo_cambio, 0) else x.subtotal end, 2) as sin_iva_en_pesos,
    x.cancelada_at is not null as cancelada,
    (x.factura_path is null and x.xml_path is null) as capturada_a_mano
  from public.ventas x
  join public.profiles p on p.id = x.vendedor_id
  join public.customers c on c.id = x.customer_id
  , params
  where p.nombre ilike '%' || params.vendedora || '%' and x.tipo = 'venta' and x.fecha between params.desde and params.hasta
)
select * from (
  select 1 as orden, fecha::text, factura, cliente, moneda::text, total_con_iva, sin_iva, sin_iva_calculado::text, tipo_cambio, sin_iva_en_pesos, cancelada::text, capturada_a_mano::text from v
  union all
  select 2, 'TOTAL (sin canceladas)', count(*)::text || ' facturas', null, null,
    sum(case when moneda = 'MXN' then total_con_iva else total_con_iva * coalesce(tipo_cambio, 0) end),
    null, sum(case when sin_iva_calculado then 1 else 0 end)::text || ' calculadas', null, sum(sin_iva_en_pesos), null, null
  from v where not cancelada
) t
order by orden, fecha;
