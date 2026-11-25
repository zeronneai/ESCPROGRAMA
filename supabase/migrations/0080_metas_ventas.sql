-- =============================================================================
-- 0080_metas_ventas.sql   (requiere 0071 y 0079)
-- METAS MENSUALES DE VENTA POR VENDEDOR:
--  * Cada meta es un monto en pesos por mes. El avance es lo registrado en Ventas diarias del mes (sin
--    canceladas); los dolares se pasan a pesos con el tipo de cambio de cada venta.
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

alter table public.metas_venta enable row level security;
revoke all on public.metas_venta from anon, authenticated;
grant select, insert, update, delete on public.metas_venta to authenticated;
drop policy if exists metas_venta_select on public.metas_venta;
create policy metas_venta_select on public.metas_venta for select to authenticated using (public.is_sales_manager() or public.is_gerente());
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

-- Avance del mes (p_mes = cualquier dia del mes). Montos solo para jefa, gerente, CEO o el propio vendedor.
drop function if exists public.metas_ventas_avance(date);
create or replace function public.metas_ventas_avance(p_mes date default null)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.local_today();
  v_ini date := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  v_fin date := (date_trunc('month', coalesce(p_mes, v_hoy)) + interval '1 month - 1 day')::date;
  v_ver boolean := public.is_sales_manager() or public.is_gerente();
  v_tc numeric := (select usd_mxn from public.tipo_cambio_para(v_hoy) limit 1);
begin
  if not (public.is_seller() or public.is_gerente()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    with s as (
      select x.vendedor_id as vid,
        sum(case when x.moneda = 'USD' then x.monto * coalesce(x.tipo_cambio, v_tc, 0) else x.monto end) as total,
        count(*)::int as n,
        count(*) filter (where x.moneda = 'USD' and x.tipo_cambio is null and v_tc is null)::int as sin_tc
      from public.ventas x
      where x.cancelada_at is null and x.fecha between v_ini and v_fin and x.monto is not null
      group by x.vendedor_id
    )
    select m.id, m.nombre, m.vendedor_id,
      case when v_ver or m.vendedor_id = auth.uid() then m.meta end,
      case when v_ver or m.vendedor_id = auth.uid() then round(coalesce(s.total, 0), 2) end,
      round(coalesce(s.total, 0) / m.meta * 100, 1),
      coalesce(s.n, 0), coalesce(s.sin_tc, 0), v_ini,
      case when v_hoy between v_ini and v_fin then extract(day from v_hoy)::int when v_hoy > v_fin then extract(day from v_fin)::int else 0 end,
      extract(day from v_fin)::int,
      m.vendedor_id = auth.uid(),
      round(sum(coalesce(s.total, 0)) over () / nullif(sum(m.meta) over (), 0) * 100, 1)
    from public.metas_venta m
    left join s on s.vid = m.vendedor_id
    where m.estado = 'activa'
    order by coalesce(s.total, 0) / m.meta desc, m.orden, m.nombre;
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
create trigger ventas_pulso after insert or update of monto, moneda, fecha, cancelada_at, vendedor_id, tipo_cambio or delete on public.ventas
  for each statement execute function public.ventas_pulso_trg();
drop trigger if exists metas_venta_pulso on public.metas_venta;
create trigger metas_venta_pulso after insert or update or delete on public.metas_venta for each statement execute function public.ventas_pulso_trg();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ventas_pulso') then
    execute 'alter publication supabase_realtime add table public.ventas_pulso';
  end if;
end $$;

commit;
