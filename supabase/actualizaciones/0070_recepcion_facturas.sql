-- =============================================================================
-- 0070_recepcion_facturas.sql   (requiere 0069 ya aplicado, en otra ejecucion)
-- Recepcion de facturas fisicas pagadas.
-- 1) El vendedor ve sus facturas ya cobradas (100%). Cuando trae las fisicas, elige cuales entrega
--    y dice con que pago se cobro cada una: un pago (fecha, monto, forma, referencia) puede cubrir
--    varias facturas. Eso forma una "entrega" a finanzas.
-- 2) La Auxiliar de administracion y finanzas (y el Supervisor de finanzas) ve por vendedor lo que
--    le entregaron, busca por folio, palomea Recibida o la Rechaza con motivo, y deja anotaciones
--    (por ejemplo: "trajo la factura X y no esta en la lista").
-- 3) El vendedor ve que se recibio, que se rechazo y por que. Una factura rechazada se puede volver
--    a entregar.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.is_finanzas() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and not must_change_password
                  and rol in ('aux_finanzas', 'supervisor_finanzas'));
$$;
grant execute on function public.is_finanzas() to authenticated;

create table public.factura_entregas (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  vendedor_id uuid not null references public.profiles (id),
  notas text check (notas is null or length(notas) <= 1000),
  estado text not null default 'por_revisar' check (estado in ('por_revisar', 'revisada')),
  revisada_at timestamptz,
  created_at timestamptz not null default now()
);
create index factura_entregas_vendedor_idx on public.factura_entregas (vendedor_id, created_at desc);

create table public.cobro_pagos (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.factura_entregas (id),
  vendedor_id uuid not null references public.profiles (id),
  fecha date not null,
  monto numeric(14, 2) not null check (monto > 0),
  moneda public.currency not null default 'MXN',
  forma text not null default 'transferencia' check (forma in ('transferencia', 'deposito', 'cheque', 'efectivo', 'otro')),
  referencia text check (referencia is null or length(referencia) <= 120),
  created_at timestamptz not null default now()
);
create index cobro_pagos_entrega_idx on public.cobro_pagos (entrega_id);

create table public.factura_recepcion (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.factura_entregas (id),
  pago_id uuid not null references public.cobro_pagos (id),
  venta_id uuid not null references public.ventas (id),
  vendedor_id uuid not null references public.profiles (id),
  estado text not null default 'por_revisar' check (estado in ('por_revisar', 'recibida', 'rechazada')),
  motivo text check (motivo is null or length(motivo) <= 500),
  revisado_por uuid references public.profiles (id),
  revisado_at timestamptz,
  created_at timestamptz not null default now(),
  check (estado <> 'rechazada' or motivo is not null)
);
create index factura_recepcion_entrega_idx on public.factura_recepcion (entrega_id);
-- Una factura solo puede estar una vez "en camino" o recibida (si se rechaza, se puede volver a entregar).
create unique index factura_recepcion_viva on public.factura_recepcion (venta_id) where estado <> 'rechazada';

create table public.factura_entrega_notas (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.factura_entregas (id),
  texto text not null check (length(trim(texto)) between 1 and 1000),
  created_by uuid references public.profiles (id) default auth.uid(),
  autor_nombre text,
  created_at timestamptz not null default now()
);
create index factura_entrega_notas_idx on public.factura_entrega_notas (entrega_id, created_at);

-- Nada se borra; todo cambia solo por las funciones de abajo.
create trigger factura_entregas_no_delete before delete on public.factura_entregas for each row execute function public.forbid_mutation();
create trigger cobro_pagos_no_delete before delete on public.cobro_pagos for each row execute function public.forbid_mutation();
create trigger factura_recepcion_no_delete before delete on public.factura_recepcion for each row execute function public.forbid_mutation();
create trigger factura_entrega_notas_immutable before update or delete on public.factura_entrega_notas for each row execute function public.forbid_mutation();
create trigger factura_recepcion_audit after insert or update on public.factura_recepcion for each row execute function public.audit_row();

alter table public.factura_entregas enable row level security;
alter table public.cobro_pagos enable row level security;
alter table public.factura_recepcion enable row level security;
alter table public.factura_entrega_notas enable row level security;
create policy factura_entregas_select on public.factura_entregas for select to authenticated
  using (vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager());
create policy cobro_pagos_select on public.cobro_pagos for select to authenticated
  using (vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager());
create policy factura_recepcion_select on public.factura_recepcion for select to authenticated
  using (vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager());
create policy factura_entrega_notas_select on public.factura_entrega_notas for select to authenticated
  using (exists (select 1 from public.factura_entregas e where e.id = entrega_id
                  and (e.vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager())));
grant select on public.factura_entregas, public.cobro_pagos, public.factura_recepcion, public.factura_entrega_notas to authenticated;

-- Finanzas lee las ventas, clientes y nombres de vendedores que necesita para revisar.
create or replace function public.finanzas_puede_ver_venta(p_venta uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_finanzas() and exists (select 1 from public.factura_recepcion r where r.venta_id = p_venta);
$$;
create policy ventas_finanzas_select on public.ventas for select to authenticated
  using (public.finanzas_puede_ver_venta(id));
create or replace function public.finanzas_puede_ver_cliente(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_finanzas() and exists (select 1 from public.ventas v join public.factura_recepcion r on r.venta_id = v.id
                                          where v.customer_id = p_id);
$$;
create policy customers_finanzas_select on public.customers for select to authenticated
  using (public.finanzas_puede_ver_cliente(id));

-- Aviso a todos los de finanzas.
create or replace function public.notify_finanzas(p_titulo text, p_cuerpo text, p_link text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  select id, 'recepcion_facturas', left(p_titulo, 200), left(p_cuerpo, 300), p_link, p_ref
    from public.profiles where activo and rol in ('aux_finanzas', 'supervisor_finanzas') and id is distinct from auth.uid();
$$;
revoke all on function public.notify_finanzas(text, text, text, uuid) from public, anon, authenticated;

-- 1) El vendedor entrega facturas pagadas, agrupadas por pago.
--    p = { notas, pagos: [ { fecha, monto, moneda, forma, referencia, ventas: [venta_id, ...] }, ... ] }
create or replace function public.facturas_entregar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ent uuid; v_pago uuid; pg jsonb; vid text; v_n integer := 0; v_folio text; v_vend text;
  v_todas uuid[] := '{}'; v record;
begin
  if not public.is_seller() then raise exception 'Solo los vendedores entregan facturas' using errcode = '42501'; end if;
  if jsonb_typeof(p -> 'pagos') <> 'array' or jsonb_array_length(p -> 'pagos') = 0 then raise exception 'Agrega al menos un pago'; end if;
  for pg in select * from jsonb_array_elements(p -> 'pagos') loop
    if jsonb_typeof(pg -> 'ventas') <> 'array' or jsonb_array_length(pg -> 'ventas') = 0 then
      raise exception 'Cada pago debe cubrir al menos una factura';
    end if;
    if nullif(pg ->> 'fecha', '') is null then raise exception 'Falta la fecha de un pago'; end if;
    if (pg ->> 'fecha')::date > public.local_today() then raise exception 'La fecha de pago no puede ser futura'; end if;
    if coalesce(nullif(pg ->> 'monto', '')::numeric, 0) <= 0 then raise exception 'Falta el monto de un pago'; end if;
    for vid in select jsonb_array_elements_text(pg -> 'ventas') loop
      if vid::uuid = any (v_todas) then raise exception 'Una factura esta en dos pagos'; end if;
      v_todas := v_todas || vid::uuid;
    end loop;
  end loop;

  for v in select s.id, s.factura, s.vendedor_id, s.tipo, s.cancelada_at, s.porcentaje_cobrado
             from public.ventas s where s.id = any (v_todas) loop
    if v.vendedor_id <> auth.uid() then raise exception 'La factura % no es tuya', coalesce(v.factura, '?'); end if;
    if v.tipo <> 'venta' or v.cancelada_at is not null then raise exception 'La venta % esta cancelada', coalesce(v.factura, '?'); end if;
    if v.porcentaje_cobrado < 100 then raise exception 'La factura % todavia no esta cobrada al 100%%', coalesce(v.factura, '?'); end if;
    if exists (select 1 from public.factura_recepcion r where r.venta_id = v.id and r.estado <> 'rechazada') then
      raise exception 'La factura % ya se entrego', coalesce(v.factura, '?');
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> cardinality(v_todas) then raise exception 'Alguna factura no existe'; end if;

  v_folio := 'ENT-' || to_char(public.local_today(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  insert into public.factura_entregas (folio, vendedor_id, notas)
  values (v_folio, auth.uid(), nullif(left(trim(coalesce(p ->> 'notas', '')), 1000), ''))
  returning id into v_ent;

  for pg in select * from jsonb_array_elements(p -> 'pagos') loop
    insert into public.cobro_pagos (entrega_id, vendedor_id, fecha, monto, moneda, forma, referencia)
    values (v_ent, auth.uid(), (pg ->> 'fecha')::date, (pg ->> 'monto')::numeric,
            case when pg ->> 'moneda' = 'USD' then 'USD' else 'MXN' end::public.currency,
            case when pg ->> 'forma' in ('transferencia', 'deposito', 'cheque', 'efectivo', 'otro') then pg ->> 'forma' else 'transferencia' end,
            nullif(left(trim(coalesce(pg ->> 'referencia', '')), 120), ''))
    returning id into v_pago;
    insert into public.factura_recepcion (entrega_id, pago_id, venta_id, vendedor_id)
    select v_ent, v_pago, x::uuid, auth.uid() from jsonb_array_elements_text(pg -> 'ventas') x;
  end loop;

  select nombre into v_vend from public.profiles where id = auth.uid();
  perform public.notify_finanzas('Facturas para recibir: ' || coalesce(v_vend, 'vendedor'),
    v_n || ' factura(s) pagada(s) en la entrega ' || v_folio, '/finanzas/recepcion/' || auth.uid(), v_ent);
  return v_ent;
end $$;
revoke all on function public.facturas_entregar(jsonb) from public, anon;
grant execute on function public.facturas_entregar(jsonb) to authenticated;

-- 2) Finanzas palomea: recibida, rechazada (con motivo) o la regresa a por revisar.
create or replace function public.factura_revisar(p_id uuid, p_estado text, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.factura_recepcion; v_fact text; v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 500), '');
begin
  if not public.is_finanzas() then raise exception 'Solo finanzas revisa las facturas' using errcode = '42501'; end if;
  if p_estado not in ('por_revisar', 'recibida', 'rechazada') then raise exception 'Estado invalido'; end if;
  select * into r from public.factura_recepcion where id = p_id for update;
  if r.id is null then raise exception 'Factura no encontrada'; end if;
  if p_estado = 'rechazada' and v_motivo is null then raise exception 'Escribe por que se rechaza'; end if;
  if r.estado = 'rechazada' and p_estado <> 'rechazada'
     and exists (select 1 from public.factura_recepcion x where x.venta_id = r.venta_id and x.id <> r.id and x.estado <> 'rechazada') then
    raise exception 'Esa factura ya se volvio a entregar en otra entrega';
  end if;
  update public.factura_recepcion
     set estado = p_estado,
         motivo = case when p_estado = 'rechazada' then v_motivo end,
         revisado_por = case when p_estado = 'por_revisar' then null else auth.uid() end,
         revisado_at = case when p_estado = 'por_revisar' then null else now() end
   where id = p_id;
  update public.factura_entregas e
     set estado = case when exists (select 1 from public.factura_recepcion x where x.entrega_id = e.id and x.estado = 'por_revisar') then 'por_revisar' else 'revisada' end,
         revisada_at = case when exists (select 1 from public.factura_recepcion x where x.entrega_id = e.id and x.estado = 'por_revisar') then null else now() end
   where e.id = r.entrega_id;
  if p_estado = 'rechazada' then
    select factura into v_fact from public.ventas where id = r.venta_id;
    perform public.notify_user(r.vendedor_id, 'recepcion_facturas', 'Finanzas rechazo la factura ' || coalesce(v_fact, ''),
      v_motivo, '/vendedor/recepcion-facturas', r.entrega_id);
  end if;
end $$;
revoke all on function public.factura_revisar(uuid, text, text) from public, anon;
grant execute on function public.factura_revisar(uuid, text, text) to authenticated;

-- 3) Anotaciones de la entrega (finanzas o el vendedor): "falta la factura X", "trajo la X que no esta en la lista".
create or replace function public.factura_entrega_nota(p_entrega uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.factura_entregas; v_txt text := left(trim(coalesce(p_texto, '')), 1000);
begin
  select * into e from public.factura_entregas where id = p_entrega;
  if e.id is null then raise exception 'Entrega no encontrada'; end if;
  if not (public.is_finanzas() or e.vendedor_id = auth.uid()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_txt = '' then raise exception 'Escribe la anotacion'; end if;
  insert into public.factura_entrega_notas (entrega_id, texto, created_by, autor_nombre)
  values (e.id, v_txt, auth.uid(), (select nombre from public.profiles where id = auth.uid()));
  if public.is_finanzas() then
    perform public.notify_user(e.vendedor_id, 'recepcion_facturas', 'Finanzas dejo una nota en la entrega ' || e.folio, v_txt, '/vendedor/recepcion-facturas', e.id);
  else
    perform public.notify_finanzas('Nota del vendedor en la entrega ' || e.folio, v_txt, '/finanzas/recepcion/' || e.vendedor_id, e.id);
  end if;
end $$;
revoke all on function public.factura_entrega_nota(uuid, text) from public, anon;
grant execute on function public.factura_entrega_nota(uuid, text) to authenticated;

-- Nombres de los vendedores para finanzas (no lee la tabla de usuarios completa).
create or replace function public.finanzas_vendedores() returns table (id uuid, nombre text, por_revisar integer, recibidas integer, rechazadas integer, ultima timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre,
         count(*) filter (where r.estado = 'por_revisar')::int,
         count(*) filter (where r.estado = 'recibida')::int,
         count(*) filter (where r.estado = 'rechazada')::int,
         max(r.created_at)
    from public.profiles p join public.factura_recepcion r on r.vendedor_id = p.id
   where public.is_finanzas() or public.is_sales_manager()
   group by p.id, p.nombre
   order by count(*) filter (where r.estado = 'por_revisar') desc, p.nombre;
$$;
grant execute on function public.finanzas_vendedores() to authenticated;

commit;
