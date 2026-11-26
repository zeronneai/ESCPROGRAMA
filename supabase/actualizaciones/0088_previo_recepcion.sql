-- =============================================================================
-- 0088_previo_recepcion.sql   (requiere 0087)
-- PAGOS IDENTIFICADOS ANTES DEL PORTAL = FACTURAS YA ENTREGADAS:
--  * Las facturas de un pago "identificado antes del portal" que si estan subidas en el portal quedan:
--      - en Recepcion de facturas como ya entregadas y RECIBIDAS (no les sale "por entregar" al vendedor);
--      - pagadas con la fecha del abono, si sus articulos ya tienen comision (si no, se quedan como estan y
--        se marcan pagadas en cuanto el vendedor ponga la comision y le de pagada).
--  * Las que no estan subidas no hacen nada (no hay venta que entregar).
--  * Se aplica a los pagos que ya se marcaron (ej. el de $432,832.84) y a los que se marquen de aqui en adelante.
--  * Las recepciones no se borran (control ISO): si luego se deshace el pago previo, la recepcion se queda.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que hizo.
-- =============================================================================
begin;

create or replace function public.conciliacion_previo_recepcion(p_mov uuid, p_uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos; r record; v_ent uuid; v_pago uuid; n int := 0; k int := 0;
begin
  select * into m from public.conciliacion_movimientos where id = p_mov;
  if m.id is null or not m.previo then return 0; end if;
  perform set_config('esc.previo', 'on', true);
  perform set_config('esc.sistema', 'on', true);

  -- Liga cada folio con su venta del portal (si esta subida).
  update public.conciliacion_facturas f set venta_id = v.id
    from public.ventas v
   where f.movimiento_id = m.id and f.venta_id is null and v.tipo = 'venta' and v.cancelada_at is null
     and upper(regexp_replace(coalesce(v.factura, ''), '\s+', '', 'g')) = upper(f.folio);

  -- Pagadas con la fecha del abono (solo si ya tienen la comision de cada articulo).
  update public.ventas v set porcentaje_cobrado = 100, fecha_cobro = m.fecha
    from public.conciliacion_facturas f
   where f.movimiento_id = m.id and f.venta_id = v.id and v.porcentaje_cobrado < 100
     and not exists (select 1 from public.venta_lineas l where l.venta_id = v.id and (l.comision_pct is null or l.importe is null));
  update public.conciliacion_facturas f set marco_pagada = true
    from public.ventas v where f.movimiento_id = m.id and f.venta_id = v.id and v.porcentaje_cobrado >= 100;

  -- Recepcion: una entrega ya revisada por vendedor, con las facturas recibidas.
  for r in
    select v.vendedor_id, array_agg(v.id) as ventas
      from public.conciliacion_facturas f join public.ventas v on v.id = f.venta_id
     where f.movimiento_id = m.id and v.vendedor_id is not null
       and not exists (select 1 from public.factura_recepcion x where x.venta_id = v.id and x.estado <> 'rechazada')
     group by v.vendedor_id
  loop
    k := k + 1;
    insert into public.factura_entregas (folio, vendedor_id, notas, estado, revisada_at)
    values ('PREV-' || left(m.id::text, 8) || '-' || k, r.vendedor_id, 'Entregadas antes del portal (pago identificado a mano)', 'revisada', now())
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

-- Al marcar un pago como previo, sus facturas subidas quedan entregadas y recibidas.
create or replace function public.conciliacion_previo_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.previo and not old.previo then
    -- Las facturas se insertan despues del update; se procesa al final de la transaccion.
    perform public.conciliacion_previo_recepcion(new.id, new.previo_por);
  end if;
  return null;
end;
$$;

-- El marcado inserta los folios despues de marcar el pago: se procesa desde la funcion que lo marca.
create or replace function public.conciliacion_marcar_previo(p_mov uuid, p_folios text[], p_nota text default null, p_para text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.puede_marcar_previo() then raise exception 'Solo la jefa de ventas, la gerente, el CEO o el comprador' using errcode = '42501'; end if;
  n := public.conciliacion_previo_aplicar(p_mov, p_folios, p_nota, p_para, auth.uid());
  perform public.conciliacion_previo_recepcion(p_mov, auth.uid());
  return n;
end;
$$;
drop function if exists public.conciliacion_previo_trg();

-- Los que ya estaban marcados.
do $$
declare r record; n int := 0;
begin
  for r in select id, previo_por from public.conciliacion_movimientos where previo loop
    n := n + public.conciliacion_previo_recepcion(r.id, r.previo_por);
  end loop;
  raise notice 'Listo: % factura(s) subidas en el portal quedaron entregadas y recibidas en Recepcion.', n;
end $$;

commit;
