-- =============================================================================
-- 0076_conciliaciones.sql   (requiere 0075 ya aplicado)
-- Conciliaciones bancarias.
--   * La Auxiliar de finanzas sube el estado de cuenta (PDF de BBVA o Banregio). El portal lee solo
--     los ABONOS (fecha, descripcion, referencia, monto); los cargos no se guardan. La cuenta que
--     termina en 157 es en dolares. Si sube otra vez un estado que ya tenia movimientos, no se repiten.
--   * Los vendedores ven los abonos en "Conciliaciones" e identifican los suyos: ponen la(s) factura(s)
--     que paga y lo "toman".
--       - Si la factura ya esta en su bitacora y no estaba pagada, queda PAGADA con la fecha del abono
--         (lleva su comision, como siempre).
--       - Si todavia no la sube, el pago queda apartado; cuando suba el PDF de esa factura se liga sola
--         y queda pagada. Mientras no la suba, no sale en Recepcion de facturas.
--   * Un abono solo lo puede tomar un vendedor. Lo puede soltar mientras no haya marcado pagada
--     ninguna factura; finanzas y la jefa de ventas pueden soltar cualquiera.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table public.conciliaciones (
  id uuid primary key default gen_random_uuid(),
  banco text not null,
  cuenta text,
  moneda public.currency not null default 'MXN',
  desde date,
  hasta date,
  archivo_path text,
  nombre_archivo text,
  abonos integer not null default 0,
  nuevos integer not null default 0,
  subida_por uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.conciliacion_movimientos (
  id uuid primary key default gen_random_uuid(),
  conciliacion_id uuid not null references public.conciliaciones (id),
  banco text not null,
  cuenta text,
  moneda public.currency not null default 'MXN',
  fecha date not null,
  descripcion text not null default '',
  referencia text,
  monto numeric(14, 2) not null check (monto > 0),
  clave text not null unique, -- cuenta|fecha|monto|descripcion|n (para no repetir al volver a subir)
  tomado_por uuid references public.profiles (id),
  tomado_nombre text,
  tomado_at timestamptz,
  created_at timestamptz not null default now()
);
create index conciliacion_mov_fecha_idx on public.conciliacion_movimientos (fecha desc);
create index conciliacion_mov_tomado_idx on public.conciliacion_movimientos (tomado_por);

create table public.conciliacion_facturas (
  id uuid primary key default gen_random_uuid(),
  movimiento_id uuid not null references public.conciliacion_movimientos (id) on delete cascade,
  folio text not null,
  venta_id uuid references public.ventas (id),
  vendedor_id uuid not null references public.profiles (id),
  marco_pagada boolean not null default false,
  created_at timestamptz not null default now(),
  unique (movimiento_id, folio)
);
create index conciliacion_fact_folio_idx on public.conciliacion_facturas (vendedor_id, upper(folio)) where venta_id is null;

alter table public.conciliaciones enable row level security;
alter table public.conciliacion_movimientos enable row level security;
alter table public.conciliacion_facturas enable row level security;
create policy conciliaciones_select on public.conciliaciones for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager());
create policy conciliacion_mov_select on public.conciliacion_movimientos for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager());
create policy conciliacion_fact_select on public.conciliacion_facturas for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager());
grant select on public.conciliaciones, public.conciliacion_movimientos, public.conciliacion_facturas to authenticated;
create trigger conciliacion_facturas_audit after insert or update or delete on public.conciliacion_facturas for each row execute function public.audit_row();

-- PDF del estado de cuenta (privado: finanzas y jefa de ventas).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conciliaciones', 'conciliaciones', false, 15728640, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy conciliaciones_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'conciliaciones' and (public.is_finanzas() or public.is_sales_manager()));
create policy conciliaciones_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'conciliaciones' and public.is_finanzas());

-- 1) Finanzas sube el estado de cuenta (ya leido en el navegador: solo abonos).
--    p = { banco, cuenta, moneda, desde, hasta, archivo_path, nombre_archivo, abonos: [ { fecha, descripcion, referencia, monto } ] }
create or replace function public.conciliacion_subir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_mon public.currency; v_n integer; v_tot integer; v_cuenta text := nullif(left(trim(coalesce(p ->> 'cuenta', '')), 30), '');
begin
  if not public.is_finanzas() then raise exception 'Solo finanzas sube conciliaciones' using errcode = '42501'; end if;
  if jsonb_typeof(p -> 'abonos') <> 'array' or jsonb_array_length(p -> 'abonos') = 0 then raise exception 'El estado de cuenta no trae abonos'; end if;
  if jsonb_array_length(p -> 'abonos') > 5000 then raise exception 'Demasiados movimientos'; end if;
  v_mon := case when p ->> 'moneda' = 'USD' then 'USD' else 'MXN' end;
  insert into public.conciliaciones (banco, cuenta, moneda, desde, hasta, archivo_path, nombre_archivo, abonos)
  values (left(coalesce(nullif(trim(p ->> 'banco'), ''), 'Banco'), 40), v_cuenta, v_mon,
          nullif(p ->> 'desde', '')::date, nullif(p ->> 'hasta', '')::date,
          nullif(left(p ->> 'archivo_path', 300), ''), nullif(left(p ->> 'nombre_archivo', 200), ''), jsonb_array_length(p -> 'abonos'))
  returning id into v_id;

  with a as (
    select (x ->> 'fecha')::date as fecha, left(trim(coalesce(x ->> 'descripcion', '')), 500) as descripcion,
           nullif(left(trim(coalesce(x ->> 'referencia', '')), 80), '') as referencia, round((x ->> 'monto')::numeric, 2) as monto
      from jsonb_array_elements(p -> 'abonos') x
     where (x ->> 'monto')::numeric > 0 and nullif(x ->> 'fecha', '') is not null
  ), n as (
    select a.*, row_number() over (partition by fecha, monto, lower(descripcion) order by referencia nulls last) as k from a
  ), ins as (
    insert into public.conciliacion_movimientos (conciliacion_id, banco, cuenta, moneda, fecha, descripcion, referencia, monto, clave)
    select v_id, left(coalesce(nullif(trim(p ->> 'banco'), ''), 'Banco'), 40), v_cuenta, v_mon, fecha, descripcion, referencia, monto,
           coalesce(v_cuenta, '') || '|' || fecha || '|' || monto || '|' || md5(lower(descripcion)) || '|' || k
      from n
    on conflict (clave) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  select count(*) into v_tot from jsonb_array_elements(p -> 'abonos');
  update public.conciliaciones set nuevos = v_n where id = v_id;

  if v_n > 0 then
    insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
    select id, 'conciliacion', 'Nuevos pagos en Conciliaciones',
           v_n || ' abono(s) nuevo(s) de ' || coalesce(p ->> 'banco', 'banco') || coalesce(' ' || right(v_cuenta, 4), '') || case when v_mon = 'USD' then ' (USD)' else '' end || ': identifica los tuyos.',
           '/vendedor/conciliaciones', v_id
      from public.profiles where activo and rol in ('vendedor', 'jefe_ventas');
  end if;
  return jsonb_build_object('id', v_id, 'nuevos', v_n, 'repetidos', v_tot - v_n);
end $$;
revoke all on function public.conciliacion_subir(jsonb) from public, anon;
grant execute on function public.conciliacion_subir(jsonb) to authenticated;

-- Liga un pago apartado con su venta y, si no estaba pagada, la marca pagada con la fecha del abono.
create or replace function public.conciliacion_aplicar(p_fila uuid, p_venta uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f public.conciliacion_facturas; v public.ventas; m public.conciliacion_movimientos;
begin
  select * into f from public.conciliacion_facturas where id = p_fila;
  select * into v from public.ventas where id = p_venta;
  select * into m from public.conciliacion_movimientos where id = f.movimiento_id;
  update public.conciliacion_facturas set venta_id = v.id where id = f.id;
  if v.porcentaje_cobrado >= 100 then return 'ya_pagada'; end if;
  update public.ventas set porcentaje_cobrado = 100, fecha_cobro = m.fecha where id = v.id;
  update public.conciliacion_facturas set marco_pagada = true where id = f.id;
  return 'pagada';
end $$;
revoke all on function public.conciliacion_aplicar(uuid, uuid) from public, anon, authenticated;

-- 2) El vendedor toma un abono: pone la(s) factura(s) que paga.
create or replace function public.conciliacion_tomar(p_mov uuid, p_folios text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos; v_folio text; v_venta uuid; v_fila uuid; v_res text; v_out jsonb := '[]'::jsonb; v_n integer := 0;
begin
  if not public.is_seller() then raise exception 'Solo los vendedores toman pagos' using errcode = '42501'; end if;
  select * into m from public.conciliacion_movimientos where id = p_mov for update;
  if m.id is null then raise exception 'Pago no encontrado'; end if;
  if m.tomado_por is not null then raise exception 'Este pago ya lo tomo %', coalesce(m.tomado_nombre, 'otro vendedor'); end if;
  for v_folio in select distinct upper(trim(x)) from unnest(p_folios) x where trim(coalesce(x, '')) <> '' loop
    if length(v_folio) > 40 then raise exception 'Folio invalido'; end if;
    v_n := v_n + 1;
    if v_n > 30 then raise exception 'Demasiadas facturas'; end if;
    select id into v_venta from public.ventas
     where vendedor_id = auth.uid() and upper(trim(factura)) = v_folio and tipo = 'venta' and cancelada_at is null
     order by created_at desc limit 1;
    insert into public.conciliacion_facturas (movimiento_id, folio, vendedor_id) values (m.id, v_folio, auth.uid()) returning id into v_fila;
    if v_venta is not null then
      v_res := public.conciliacion_aplicar(v_fila, v_venta);
    else
      v_res := 'pendiente';
    end if;
    v_out := v_out || jsonb_build_object('folio', v_folio, 'estado', v_res);
  end loop;
  if v_n = 0 then raise exception 'Escribe la factura que paga este abono'; end if;
  update public.conciliacion_movimientos
     set tomado_por = auth.uid(), tomado_at = now(), tomado_nombre = (select nombre from public.profiles where id = auth.uid())
   where id = m.id;
  return v_out;
end $$;
revoke all on function public.conciliacion_tomar(uuid, text[]) from public, anon;
grant execute on function public.conciliacion_tomar(uuid, text[]) to authenticated;

-- 3) Soltar un abono (el vendedor, si no marco ninguna factura pagada; finanzas o la jefa, siempre).
--    Las ventas que ya se marcaron pagadas se quedan asi (se corrigen en la venta).
create or replace function public.conciliacion_soltar(p_mov uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos;
begin
  select * into m from public.conciliacion_movimientos where id = p_mov for update;
  if m.id is null then raise exception 'Pago no encontrado'; end if;
  if not (public.is_finanzas() or public.is_sales_manager() or m.tomado_por = auth.uid()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not (public.is_finanzas() or public.is_sales_manager())
     and exists (select 1 from public.conciliacion_facturas where movimiento_id = m.id and marco_pagada) then
    raise exception 'Ya marco una factura como pagada: para soltarlo, pidele a la jefa de ventas o a finanzas';
  end if;
  delete from public.conciliacion_facturas where movimiento_id = m.id;
  update public.conciliacion_movimientos set tomado_por = null, tomado_at = null, tomado_nombre = null where id = m.id;
end $$;
revoke all on function public.conciliacion_soltar(uuid) from public, anon;
grant execute on function public.conciliacion_soltar(uuid) to authenticated;

-- 4) Al subir la factura a la bitacora: si ya habia un pago apartado con ese folio, se liga y queda pagada.
create or replace function public.conciliacion_ligar_venta(p_venta uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.ventas; f record; v_out jsonb := '[]'::jsonb; v_res text;
begin
  select * into v from public.ventas where id = p_venta;
  if v.id is null or v.factura is null or v.tipo <> 'venta' or v.cancelada_at is not null then return v_out; end if;
  if not (v.vendedor_id = auth.uid() or public.is_sales_manager()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  for f in
    select cf.id, m.fecha from public.conciliacion_facturas cf join public.conciliacion_movimientos m on m.id = cf.movimiento_id
     where cf.venta_id is null and cf.vendedor_id = v.vendedor_id and upper(cf.folio) = upper(trim(v.factura))
  loop
    begin
      v_res := public.conciliacion_aplicar(f.id, v.id);
    exception when others then
      -- Por ejemplo, le falta la comision: queda ligada y se marca pagada desde Conciliaciones.
      update public.conciliacion_facturas set venta_id = v.id where id = f.id;
      v_res := 'falta_comision';
    end;
    v_out := v_out || jsonb_build_object('fecha', f.fecha, 'estado', v_res);
  end loop;
  return v_out;
end $$;
revoke all on function public.conciliacion_ligar_venta(uuid) from public, anon;
grant execute on function public.conciliacion_ligar_venta(uuid) to authenticated;

-- 5) Marcar pagada una factura ligada que se quedo sin marcar (por ejemplo, ya con su comision).
create or replace function public.conciliacion_marcar_pagada(p_fila uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f public.conciliacion_facturas;
begin
  select * into f from public.conciliacion_facturas where id = p_fila;
  if f.id is null or f.venta_id is null then raise exception 'Primero sube la factura a tu bitacora'; end if;
  if not (f.vendedor_id = auth.uid() or public.is_sales_manager()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return public.conciliacion_aplicar(f.id, f.venta_id);
end $$;
revoke all on function public.conciliacion_marcar_pagada(uuid) from public, anon;
grant execute on function public.conciliacion_marcar_pagada(uuid) to authenticated;

commit;
