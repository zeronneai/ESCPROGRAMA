-- =============================================================================
-- recepcion_previos.sql   (de una sola vez; correr DESPUES de marcar_previos_final.sql)
-- Saca de la bandeja de la auxiliar de finanzas las facturas "por revisar" cuyo pago NO es uno de los que
-- faltan por identificar (tu lista). O sea: el pago que puso el vendedor corresponde a un abono "antes del
-- portal" o a ninguno de los estados de cuenta subidos (pagos viejos). Esas quedan RECIBIDAS.
-- Las que coinciden con un abono pendiente de tu lista se quedan "por revisar" para que finanzas las revise.
-- Aplica a todos los vendedores (no solo Diana) y solo a lo entregado hasta hoy.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que hizo.
-- =============================================================================
do $$
declare
  r record;
  n int := 0;
  v_lista text := '';
  v_uid uuid := (select id from public.profiles where rol = 'comprador' and activo order by created_at limit 1);
begin
  for r in
    select x.id, pr.nombre as vendedora, v.factura, p.fecha, p.monto
      from public.factura_recepcion x
      join public.profiles pr on pr.id = x.vendedor_id
      join public.ventas v on v.id = x.venta_id
      join public.cobro_pagos p on p.id = x.pago_id
     where x.estado = 'por_revisar' and x.created_at < now()
       -- Se queda si su pago coincide con un abono que todavia falta por identificar (o que no es previo).
       and not exists (select 1 from public.conciliacion_movimientos m
                        where m.monto = p.monto and abs(m.fecha - p.fecha) <= 5 and not m.previo)
     order by pr.nombre, p.fecha
  loop
    update public.factura_recepcion set estado = 'recibida', revisado_por = v_uid, revisado_at = now() where id = r.id;
    v_lista := v_lista || format(E'\n  %s  %s  pago %s $%s', r.vendedora, r.factura, r.fecha, r.monto);
    n := n + 1;
  end loop;

  -- Entregas que ya no tienen nada por revisar: revisadas.
  update public.factura_entregas e set estado = 'revisada', revisada_at = coalesce(e.revisada_at, now())
   where e.estado = 'por_revisar' and not exists (select 1 from public.factura_recepcion x where x.entrega_id = e.id and x.estado = 'por_revisar');

  raise notice 'Listo: % factura(s) quedaron recibidas: %', n, v_lista;
  raise notice 'Siguen por revisar (su pago es de tu lista o ya lo identifico un vendedor): %',
    (select count(*) from public.factura_recepcion where estado = 'por_revisar');
end $$;
