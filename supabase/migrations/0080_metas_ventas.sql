-- =============================================================================
-- 0080_metas_ventas.sql   (requiere 0071 y 0079)
-- METAS MENSUALES DE VENTA POR VENDEDOR:
--  * Cada meta es un monto en pesos SIN IVA por mes. El avance es lo registrado en Ventas diarias del mes
--    (sin canceladas), SIN IVA; los dolares se pasan a pesos con el tipo de cambio de cada venta.
--  * VENTAS SIN IVA: ventas.subtotal guarda el subtotal de la factura. Las ventas que ya estaban toman la
--    suma de los importes de sus articulos (si todos lo tienen) o, si no, el total entre el factor de IVA
--    que se ve en las facturas (marcado como estimado; se corrige solo al leer los importes).
--  * Un usuario (ej. telemarketing) puede capturar a mano las ventas de una meta sin usuario (Jose Ortiz).
--  * La jefa de ventas cambia los montos, pausa metas, liga una meta a un usuario o agrega nuevas.
--  * Casa Local y VTS Cd Juarez quedan en pausa. Jose Ortiz no tiene usuario: su meta se muestra en 0
--    hasta que se le ligue uno. Ivan Munoz ya no esta y no se agrega.
--  * Todos los de ventas ven los porcentajes; los montos solo la jefa, gerente, CEO y cada quien el suyo.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.metas_venta (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  vendedor_id uuid unique references public.profiles (id) on delete set null,
  meta numeric(14, 2) not null check (meta > 0),
  estado text not null default 'activa' check (estado in ('activa', 'pausada')),
  orden int not null default 0,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.metas_venta add column if not exists capturista_id uuid references public.profiles (id) on delete set null;

alter table public.metas_venta enable row level security;
revoke all on public.metas_venta from anon, authenticated;
grant select, insert, update, delete on public.metas_venta to authenticated;
drop policy if exists metas_venta_select on public.metas_venta;
create policy metas_venta_select on public.metas_venta for select to authenticated
  using (public.is_sales_manager() or public.is_gerente() or capturista_id = auth.uid());
drop policy if exists metas_venta_write on public.metas_venta;
create policy metas_venta_write on public.metas_venta for all to authenticated using (public.is_sales_manager()) with check (public.is_sales_manager());

-- Metas iniciales (se ligan al usuario cuyo nombre coincide).
do $$
declare
  r record;
  v uuid;
  sin text := 'áéíóúüñÁÉÍÓÚÜÑ';
  con text := 'aeiouunAEIOUUN';
begin
  for r in select * from (values
    ('Alejandra Rangel', 1861600, 'activa', '%alejandra%rangel%', 1),
    ('Jose Ortiz', 1861600, 'activa', '%jose%ortiz%', 2),
    ('Blanca Aguirre', 1861600, 'activa', '%blanca%aguirre%', 3),
    ('Esteban Ruiz', 951330, 'activa', '%esteban%ruiz%', 4),
    ('Berenice Bustillos', 951330, 'activa', '%berenice%bustillos%', 5),
    ('Diana Perez', 486150, 'activa', '%diana%perez%', 6),
    ('Diana Fierro', 486150, 'activa', '%diana%fierro%', 7),
    ('Alejandra Meraz', 486150, 'activa', '%alejandra%meraz%', 8),
    ('Casa Local', 486150, 'pausada', null, 9),
    ('VTS Cd Juarez', 486150, 'pausada', null, 10)
  ) as t(nombre, meta, estado, patron, orden) loop
    if exists (select 1 from public.metas_venta m where lower(translate(m.nombre, sin, con)) = lower(translate(r.nombre, sin, con))) then continue; end if;
    v := null;
    if r.patron is not null then
      select p.id into v from public.profiles p
        where lower(translate(p.nombre, sin, con)) like r.patron and p.activo
          and not exists (select 1 from public.metas_venta m where m.vendedor_id = p.id)
        order by (p.rol = 'vendedor') desc, p.created_at limit 1;
    end if;
    insert into public.metas_venta (nombre, vendedor_id, meta, estado, orden) values (r.nombre, v, r.meta, r.estado, r.orden);
    raise notice '% -> %', r.nombre, coalesce((select nombre from public.profiles where id = v), 'sin usuario');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ventas sin IVA
-- ---------------------------------------------------------------------------
alter table public.ventas
  add column if not exists subtotal numeric(14, 2) check (subtotal is null or subtotal >= 0),
  add column if not exists subtotal_estimado boolean not null default false;

-- Factor total / subtotal que traen las facturas reales (1.16, o 1.08 en la frontera); 1.16 si no hay datos.
create or replace function public.iva_factor() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((
    select percentile_cont(0.5) within group (order by monto / subtotal)
    from public.ventas where not subtotal_estimado and subtotal > 0 and monto > 0 and monto / subtotal between 1 and 1.2
  ), 1.16)::numeric;
$$;

-- Sin subtotal real se saca del monto: si la venta trae factura (PDF/XML) el monto es el total con IVA y se
-- divide entre el factor; si se capturo a mano, el monto ya es sin IVA (asi lo pide el formulario).
create or replace function public.ventas_subtotal_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.monto is null then
    if new.subtotal_estimado then new.subtotal := null; end if;
  elsif new.subtotal is null or (new.subtotal_estimado and (tg_op = 'INSERT' or new.monto is distinct from old.monto
        or (new.factura_path is null and new.xml_path is null) <> (old.factura_path is null and old.xml_path is null))) then
    new.subtotal := round(new.monto / (case when new.factura_path is not null or new.xml_path is not null then public.iva_factor() else 1 end), 2);
    new.subtotal_estimado := true;
  end if;
  return new;
end;
$$;
drop trigger if exists ventas_subtotal on public.ventas;
create trigger ventas_subtotal before insert or update of monto, subtotal, factura_path, xml_path on public.ventas for each row execute function public.ventas_subtotal_trg();

-- Subtotal de la factura (lo manda el portal al subirla).
create or replace function public.venta_subtotal_factura(p_venta uuid, p_subtotal numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v public.ventas;
begin
  select * into v from public.ventas where id = p_venta;
  if v.id is null then raise exception 'Venta no encontrada'; end if;
  if not (v.vendedor_id = auth.uid() or public.is_sales_manager()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_subtotal is null or p_subtotal <= 0 then raise exception 'Subtotal invalido'; end if;
  update public.ventas set subtotal = round(p_subtotal, 2), subtotal_estimado = false where id = p_venta;
end;
$$;
revoke all on function public.venta_subtotal_factura(uuid, numeric) from public, anon;
grant execute on function public.venta_subtotal_factura(uuid, numeric) to authenticated;

-- Cuando todos los articulos de una venta ya tienen importe (sin IVA), esa suma es el subtotal.
create or replace function public.venta_lineas_subtotal_trg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.venta_id, old.venta_id); v_sum numeric;
begin
  if exists (select 1 from public.ventas where id = v_id and subtotal_estimado)
     and not exists (select 1 from public.venta_lineas where venta_id = v_id and importe is null)
     and exists (select 1 from public.venta_lineas where venta_id = v_id) then
    select sum(importe) into v_sum from public.venta_lineas where venta_id = v_id;
    if v_sum > 0 then update public.ventas set subtotal = round(v_sum, 2), subtotal_estimado = false where id = v_id; end if;
  end if;
  return null;
end;
$$;
drop trigger if exists venta_lineas_subtotal on public.venta_lineas;
create trigger venta_lineas_subtotal after insert or update of importe on public.venta_lineas for each row execute function public.venta_lineas_subtotal_trg();

-- Ventas que ya estaban: primero las que tienen todos sus importes, luego el resto estimado.
update public.ventas v set subtotal = round(l.suma, 2), subtotal_estimado = false
  from (select venta_id, sum(importe) suma from public.venta_lineas group by venta_id having count(*) = count(importe) and sum(importe) > 0) l
  where l.venta_id = v.id and v.subtotal is null and v.monto is not null;
update public.ventas set subtotal = round(monto / (case when factura_path is not null or xml_path is not null then public.iva_factor() else 1 end), 2), subtotal_estimado = true
  where subtotal is null and monto is not null;

-- ---------------------------------------------------------------------------
-- Ventas capturadas a mano para una meta sin usuario (Jose Ortiz): siempre sin IVA.
-- ---------------------------------------------------------------------------
create table if not exists public.metas_venta_capturas (
  id uuid primary key default gen_random_uuid(),
  meta_id uuid not null references public.metas_venta (id) on delete cascade,
  fecha date not null default public.local_today(),
  folio text check (folio is null or length(folio) <= 60),
  cliente text check (cliente is null or length(cliente) <= 200),
  subtotal numeric(14, 2) not null check (subtotal > 0),
  moneda public.currency not null default 'MXN',
  tipo_cambio numeric(10, 4) check (tipo_cambio is null or tipo_cambio between 5 and 60),
  nota text check (nota is null or length(nota) <= 500),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  cancelada_at timestamptz
);
create index if not exists metas_venta_capturas_idx on public.metas_venta_capturas (meta_id, fecha);
alter table public.metas_venta_capturas enable row level security;
revoke all on public.metas_venta_capturas from anon, authenticated;
grant select, insert on public.metas_venta_capturas to authenticated;
grant update (cancelada_at) on public.metas_venta_capturas to authenticated;
create or replace function public.puede_capturar_meta(p_meta uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_sales_manager() or exists (select 1 from public.metas_venta where id = p_meta and capturista_id = auth.uid());
$$;
drop policy if exists metas_venta_capturas_select on public.metas_venta_capturas;
create policy metas_venta_capturas_select on public.metas_venta_capturas for select to authenticated
  using (public.puede_capturar_meta(meta_id) or public.is_gerente());
drop policy if exists metas_venta_capturas_insert on public.metas_venta_capturas;
create policy metas_venta_capturas_insert on public.metas_venta_capturas for insert to authenticated
  with check (public.puede_capturar_meta(meta_id) and created_by = auth.uid() and cancelada_at is null);
drop policy if exists metas_venta_capturas_update on public.metas_venta_capturas;
create policy metas_venta_capturas_update on public.metas_venta_capturas for update to authenticated
  using (public.puede_capturar_meta(meta_id)) with check (public.puede_capturar_meta(meta_id));

-- Avance del mes (p_mes = cualquier dia del mes). Montos solo para jefa, gerente, CEO o el propio vendedor.
drop function if exists public.metas_ventas_avance(date);
create or replace function public.metas_ventas_avance(p_mes date default null)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.local_today();
  v_ini date := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  v_fin date := (date_trunc('month', coalesce(p_mes, v_hoy)) + interval '1 month - 1 day')::date;
  v_ver boolean := public.is_sales_manager() or public.is_gerente();
  v_tc numeric := (select usd_mxn from public.tipo_cambio_para(v_hoy) limit 1);
begin
  if not (public.is_seller() or public.is_gerente() or public.is_buyer()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    with s as (
      select x.vendedor_id as vid,
        sum(case when x.moneda = 'USD' then x.subtotal * coalesce(x.tipo_cambio, v_tc, 0) else x.subtotal end) as total,
        count(*)::int as n,
        count(*) filter (where x.moneda = 'USD' and x.tipo_cambio is null and v_tc is null)::int as sin_tc
      from public.ventas x
      where x.cancelada_at is null and x.fecha between v_ini and v_fin and x.subtotal is not null
      group by x.vendedor_id
    ), cap as (
      select c.meta_id,
        sum(case when c.moneda = 'USD' then c.subtotal * coalesce(c.tipo_cambio, (select usd_mxn from public.tipo_cambio_para(c.fecha) limit 1), v_tc, 0) else c.subtotal end) as total,
        count(*)::int as n
      from public.metas_venta_capturas c
      where c.cancelada_at is null and c.fecha between v_ini and v_fin
      group by c.meta_id
    ), t as (
      select m.*, coalesce(s.total, 0) + coalesce(cap.total, 0) as total, coalesce(s.n, 0) + coalesce(cap.n, 0) as n, coalesce(s.sin_tc, 0) as sin_tc
      from public.metas_venta m
      left join s on s.vid = m.vendedor_id
      left join cap on cap.meta_id = m.id
      where m.estado = 'activa'
    )
    select m.id, m.nombre, m.vendedor_id,
      case when v_ver or m.vendedor_id = auth.uid() or m.capturista_id = auth.uid() then m.meta end,
      case when v_ver or m.vendedor_id = auth.uid() or m.capturista_id = auth.uid() then round(m.total, 2) end,
      round(m.total / m.meta * 100, 1),
      m.n, m.sin_tc, v_ini,
      case when v_hoy between v_ini and v_fin then extract(day from v_hoy)::int when v_hoy > v_fin then extract(day from v_fin)::int else 0 end,
      extract(day from v_fin)::int,
      m.vendedor_id = auth.uid(),
      round(sum(m.total) over () / nullif(sum(m.meta) over (), 0) * 100, 1),
      m.capturista_id = auth.uid()
    from t m
    order by m.total / m.meta desc, m.orden, m.nombre;
end;
$$;
revoke all on function public.metas_ventas_avance(date) from public, anon;
grant execute on function public.metas_ventas_avance(date) to authenticated;

-- Pulso de ventas: cada venta nueva, cambio o cancelacion lo actualiza; todos los de ventas lo escuchan en
-- tiempo real (las ventas de otros no las pueden leer, pero si saber que hubo una para refrescar las graficas).
create table if not exists public.ventas_pulso (id int primary key default 1 check (id = 1), at timestamptz not null default now());
insert into public.ventas_pulso (id) values (1) on conflict do nothing;
alter table public.ventas_pulso enable row level security;
revoke all on public.ventas_pulso from anon, authenticated;
grant select on public.ventas_pulso to authenticated;
drop policy if exists ventas_pulso_select on public.ventas_pulso;
create policy ventas_pulso_select on public.ventas_pulso for select to authenticated using (public.is_active_user());

create or replace function public.ventas_pulso_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.ventas_pulso set at = now() where id = 1;
  return null;
end;
$$;
drop trigger if exists ventas_pulso on public.ventas;
create trigger ventas_pulso after insert or update of monto, subtotal, moneda, fecha, cancelada_at, vendedor_id, tipo_cambio or delete on public.ventas
  for each statement execute function public.ventas_pulso_trg();
drop trigger if exists metas_venta_pulso on public.metas_venta;
create trigger metas_venta_pulso after insert or update or delete on public.metas_venta for each statement execute function public.ventas_pulso_trg();
drop trigger if exists metas_venta_capturas_pulso on public.metas_venta_capturas;
create trigger metas_venta_capturas_pulso after insert or update or delete on public.metas_venta_capturas for each statement execute function public.ventas_pulso_trg();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ventas_pulso') then
    execute 'alter publication supabase_realtime add table public.ventas_pulso';
  end if;
end $$;

commit;
