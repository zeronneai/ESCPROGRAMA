-- =============================================================================
-- 0089_previo_conservar.sql   (requiere 0088)
-- PAGOS PREVIOS QUE YA HABIA IDENTIFICADO UN VENDEDOR:
--  * Un abono que ya identifico un vendedor tambien se puede pasar a "Identificado antes del portal" sin
--    perder a quien se identifico ni sus facturas (le sigue saliendo en "Los mios").
--  * Al pasar a previo, sus facturas salen de la bandeja de la auxiliar de finanzas: las que estaban
--    "por revisar" en Recepcion quedan recibidas, y las que no se habian entregado quedan recibidas
--    tambien (no le salen al vendedor para entregar).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- Recepcion de las facturas de un pago previo: tambien cierra las que estaban por revisar.
create or replace function public.conciliacion_previo_recepcion(p_mov uuid, p_uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos; r record; v_ent uuid; v_pago uuid; n int := 0; k int := 0;
begin
  select * into m from public.conciliacion_movimientos where id = p_mov;
  if m.id is null or not m.previo then return 0; end if;
  perform set_config('esc.previo', 'on', true);
  perform set_config('esc.sistema', 'on', true);

  update public.conciliacion_facturas f set venta_id = v.id
    from public.ventas v
   where f.movimiento_id = m.id and f.venta_id is null and v.tipo = 'venta' and v.cancelada_at is null
     and upper(regexp_replace(coalesce(v.factura, ''), '\s+', '', 'g')) = upper(f.folio);

  update public.ventas v set porcentaje_cobrado = 100, fecha_cobro = coalesce(v.fecha_cobro, m.fecha)
    from public.conciliacion_facturas f
   where f.movimiento_id = m.id and f.venta_id = v.id and v.porcentaje_cobrado < 100
     and not exists (select 1 from public.venta_lineas l where l.venta_id = v.id and (l.comision_pct is null or l.importe is null));
  update public.conciliacion_facturas f set marco_pagada = true
    from public.ventas v where f.movimiento_id = m.id and f.venta_id = v.id and v.porcentaje_cobrado >= 100 and not f.marco_pagada;

  -- Las que ya estaban entregadas y por revisar: recibidas (salen de la bandeja de finanzas).
  update public.factura_recepcion x set estado = 'recibida', revisado_por = p_uid, revisado_at = now()
    from public.conciliacion_facturas f
   where f.movimiento_id = m.id and f.venta_id = x.venta_id and x.estado = 'por_revisar';
  get diagnostics k = row_count;
  n := n + k;
  update public.factura_entregas e set estado = 'revisada', revisada_at = coalesce(e.revisada_at, now())
   where e.estado = 'por_revisar'
     and exists (select 1 from public.factura_recepcion x join public.conciliacion_facturas f on f.venta_id = x.venta_id where x.entrega_id = e.id and f.movimiento_id = m.id)
     and not exists (select 1 from public.factura_recepcion x where x.entrega_id = e.id and x.estado = 'por_revisar');

  -- Las que no se habian entregado: una entrega ya revisada, con las facturas recibidas.
  k := 0;
  for r in
    select v.vendedor_id, array_agg(v.id) as ventas
      from public.conciliacion_facturas f join public.ventas v on v.id = f.venta_id
     where f.movimiento_id = m.id and v.vendedor_id is not null
       and not exists (select 1 from public.factura_recepcion x where x.venta_id = v.id and x.estado <> 'rechazada')
     group by v.vendedor_id
  loop
    k := k + 1;
    v_ent := null;
    insert into public.factura_entregas (folio, vendedor_id, notas, estado, revisada_at)
    values ('PREV-' || left(m.id::text, 8) || '-' || k || '-' || left(md5(clock_timestamp()::text), 4), r.vendedor_id,
            'Entregadas antes del portal (pago identificado a mano)', 'revisada', now())
    on conflict (folio) do nothing
    returning id into v_ent;
    if v_ent is null then continue; end if;
    insert into public.cobro_pagos (entrega_id, vendedor_id, fecha, monto, moneda, forma, referencia)
    values (v_ent, r.vendedor_id, m.fecha, m.monto, m.moneda, 'transferencia', left('Conciliacion ' || m.banco || ' ' || coalesce(m.descripcion, ''), 120))
    returning id into v_pago;
    insert into public.factura_recepcion (entrega_id, pago_id, venta_id, vendedor_id, estado, revisado_por, revisado_at)
    select v_ent, v_pago, x, r.vendedor_id, 'recibida', p_uid, now() from unnest(r.ventas) x;
    n := n + cardinality(r.ventas);
  end loop;

  perform set_config('esc.sistema', 'off', true);
  perform set_config('esc.previo', 'off', true);
  return n;
end;
$$;
revoke all on function public.conciliacion_previo_recepcion(uuid, uuid) from public, anon, authenticated;

-- Pasar a previo SIN quitar a quien se identifico ni sus facturas (uso interno y para la direccion).
create or replace function public.conciliacion_previo_conservar(p_mov uuid, p_nota text, p_uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos; v_quien uuid;
begin
  select * into m from public.conciliacion_movimientos where id = p_mov for update;
  if m.id is null or m.previo then return 0; end if;
  v_quien := coalesce(p_uid, (select id from public.profiles where rol = 'comprador' and activo order by created_at limit 1),
                     (select id from public.profiles where rol = 'jefe_ventas' and activo order by created_at limit 1));
  perform set_config('esc.previo', 'on', true);
  update public.conciliacion_movimientos
     set previo = true, previo_nota = nullif(left(trim(coalesce(p_nota, '')), 1000), ''), previo_por = v_quien, previo_at = now(),
         tomado_por = coalesce(tomado_por, v_quien), tomado_at = coalesce(tomado_at, now()),
         tomado_nombre = coalesce(tomado_nombre, 'Identificado antes del portal'), tardio = false
   where id = m.id;
  perform set_config('esc.previo', 'off', true);
  return public.conciliacion_previo_recepcion(m.id, v_quien);
end;
$$;
revoke all on function public.conciliacion_previo_conservar(uuid, text, uuid) from public, anon, authenticated;

commit;
