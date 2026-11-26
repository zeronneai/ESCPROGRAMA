-- =============================================================================
-- revisar_recepcion_vendedor.sql   (solo consulta, no cambia nada)
-- Facturas que una vendedora entrego a finanzas y siguen "por revisar", con el pago que ella puso y el
-- abono del banco que le corresponde (por monto, +-5 dias) y en que quedo ese abono.
-- Cambia el nombre en la linea "params" si quieres ver a otra vendedora.
-- =============================================================================
with params as (select 'Diana Perez'::text as vendedora)
select
  v.factura                          as factura,
  c.nombre                           as cliente,
  v.monto                            as total_factura,
  e.folio                            as entrega,
  e.created_at::date                 as entregada_el,
  p.fecha                            as fecha_pago_que_puso,
  p.monto                            as monto_pago_que_puso,
  coalesce((
    select string_agg(format('%s %s $%s: %s', m.banco, m.fecha, m.monto,
             case when m.previo then 'ANTES DEL PORTAL' when m.tomado_por is not null then 'identificado por ' || coalesce(m.tomado_para, m.tomado_nombre) else 'PENDIENTE (de tu lista)' end), ' | ')
      from public.conciliacion_movimientos m
     where m.monto = p.monto and abs(m.fecha - p.fecha) <= 5
  ), 'no hay abono con ese monto en los estados de cuenta subidos') as abono_del_banco
from public.factura_recepcion r
join public.profiles pr on pr.id = r.vendedor_id
join public.ventas v on v.id = r.venta_id
left join public.customers c on c.id = v.customer_id
join public.factura_entregas e on e.id = r.entrega_id
join public.cobro_pagos p on p.id = r.pago_id
, params
where r.estado = 'por_revisar' and pr.nombre ilike '%' || params.vendedora || '%'
order by p.fecha, v.factura;
