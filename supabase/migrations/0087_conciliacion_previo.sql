-- =============================================================================
-- 0087_conciliacion_previo.sql   (requiere 0077)
-- PAGOS IDENTIFICADOS ANTES DEL PORTAL:
--  * Al subir el estado de cuenta del mes completo salen abonos que ya se habian identificado a mano (antes
--    del portal). Se marcan "Identificado antes del portal" con sus folios (no hace falta que las facturas
--    esten subidas) y una nota.
--  * Ya no salen como pendientes ni en rojo, no cuentan como tardios y nadie los puede tomar, soltar ni
--    marcar: ni vendedores ni finanzas (ese pago ya se recibio fisicamente).
--  * Lo hacen la jefa de ventas, la gerente, el CEO o el comprador; ellos mismos lo pueden deshacer.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.conciliacion_movimientos
  add column if not exists previo boolean not null default false,
  add column if not exists previo_nota text check (previo_nota is null or length(previo_nota) <= 1000),
  add column if not exists previo_por uuid references public.profiles (id),
  add column if not exists previo_at timestamptz;

-- El comprador tambien ve las conciliaciones (para marcar los pagos identificados antes del portal).
drop policy if exists conciliaciones_select on public.conciliaciones;
create policy conciliaciones_select on public.conciliaciones for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager() or public.is_gerente() or public.is_buyer());
drop policy if exists conciliacion_mov_select on public.conciliacion_movimientos;
create policy conciliacion_mov_select on public.conciliacion_movimientos for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager() or public.is_gerente() or public.is_buyer());
drop policy if exists conciliacion_fact_select on public.conciliacion_facturas;
create policy conciliacion_fact_select on public.conciliacion_facturas for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager() or public.is_gerente() or public.is_buyer());

-- Quien puede marcar o deshacer un pago identificado antes del portal.
create or replace function public.puede_marcar_previo() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_sales_manager() or public.is_gerente() or public.is_buyer();
$$;

-- Un pago marcado "previo" no se toca (solo con esc.previo = on, que ponen las funciones de abajo).
create or replace function public.conciliacion_previo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('esc.previo', true) = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'conciliacion_movimientos' then
    if old.previo then raise exception 'Este pago ya se identifico antes del portal: no se puede cambiar' using errcode = '42501'; end if;
    return new;
  end if;
  if exists (select 1 from public.conciliacion_movimientos where id = coalesce(new.movimiento_id, old.movimiento_id) and previo) then
    raise exception 'Este pago ya se identifico antes del portal: no se puede cambiar' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists conciliacion_mov_previo on public.conciliacion_movimientos;
create trigger conciliacion_mov_previo before update on public.conciliacion_movimientos for each row execute function public.conciliacion_previo_guard();
drop trigger if exists conciliacion_fact_previo on public.conciliacion_facturas;
create trigger conciliacion_fact_previo before insert or update or delete on public.conciliacion_facturas for each row execute function public.conciliacion_previo_guard();

-- Marcar (uso interno). p_uid = quien lo marca (null desde el SQL Editor).
create or replace function public.conciliacion_previo_aplicar(p_mov uuid, p_folios text[], p_nota text, p_para text, p_uid uuid)
returns int language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos; f text; n int := 0; v_quien uuid;
begin
  select * into m from public.conciliacion_movimientos where id = p_mov for update;
  if m.id is null then raise exception 'Pago no encontrado'; end if;
  if m.previo then raise exception 'Ese pago ya esta marcado como identificado antes del portal'; end if;
  if m.tomado_por is not null and exists (select 1 from public.conciliacion_facturas where movimiento_id = m.id and marco_pagada) then
    raise exception 'Ese pago ya se uso para marcar facturas pagadas en el portal: primero sueltalo';
  end if;
  v_quien := coalesce(p_uid, (select id from public.profiles where rol = 'comprador' and activo order by created_at limit 1),
                     (select id from public.profiles where rol = 'jefe_ventas' and activo order by created_at limit 1));
  perform set_config('esc.previo', 'on', true);
  delete from public.conciliacion_facturas where movimiento_id = m.id;
  update public.conciliacion_movimientos
     set previo = true, previo_nota = nullif(left(trim(coalesce(p_nota, '')), 1000), ''), previo_por = v_quien, previo_at = now(),
         tomado_por = v_quien, tomado_at = now(), tomado_nombre = 'Identificado antes del portal',
         tomado_para = nullif(left(trim(coalesce(p_para, '')), 120), ''), tardio = false,
         -- Si el asesor es un vendedor del portal, el pago le sale en "Los mios".
         vendedor_id = (select p.id from public.profiles p where p_para is not null and lower(trim(p.nombre)) = lower(trim(p_para)) and p.activo limit 1)
   where id = m.id;
  foreach f in array coalesce(p_folios, '{}') loop
    f := upper(regexp_replace(trim(f), '\s+', '', 'g'));
    if f <> '' then
      insert into public.conciliacion_facturas (movimiento_id, folio, venta_id, vendedor_id, marco_pagada)
      values (m.id, left(f, 40), null, null, false) on conflict (movimiento_id, folio) do nothing;
      n := n + 1;
    end if;
  end loop;
  perform set_config('esc.previo', 'off', true);
  return n;
end;
$$;
revoke all on function public.conciliacion_previo_aplicar(uuid, text[], text, text, uuid) from public, anon, authenticated;

create or replace function public.conciliacion_marcar_previo(p_mov uuid, p_folios text[], p_nota text default null, p_para text default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_marcar_previo() then raise exception 'Solo la jefa de ventas, la gerente, el CEO o el comprador' using errcode = '42501'; end if;
  return public.conciliacion_previo_aplicar(p_mov, p_folios, p_nota, p_para, auth.uid());
end;
$$;
revoke all on function public.conciliacion_marcar_previo(uuid, text[], text, text) from public, anon;
grant execute on function public.conciliacion_marcar_previo(uuid, text[], text, text) to authenticated;

create or replace function public.conciliacion_quitar_previo(p_mov uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_marcar_previo() then raise exception 'Solo la jefa de ventas, la gerente, el CEO o el comprador' using errcode = '42501'; end if;
  perform set_config('esc.previo', 'on', true);
  delete from public.conciliacion_facturas where movimiento_id = p_mov;
  update public.conciliacion_movimientos
     set previo = false, previo_nota = null, previo_por = null, previo_at = null,
         tomado_por = null, tomado_at = null, tomado_nombre = null, tomado_para = null, vendedor_id = null, tardio = false
   where id = p_mov and previo;
  perform set_config('esc.previo', 'off', true);
end;
$$;
revoke all on function public.conciliacion_quitar_previo(uuid) from public, anon;
grant execute on function public.conciliacion_quitar_previo(uuid) to authenticated;

commit;
