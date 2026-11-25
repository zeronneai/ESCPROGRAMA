-- =============================================================================
-- 0079_meta_prospeccion.sql   (requiere 0019)
-- META DIARIA DE PROSPECCION:
--  * Cada vendedor es de "telemarketing" (meta 8 prospectos por dia) o de "campo" (meta 2), o "sin meta".
--    La jefa de ventas cambia las metas, la fecha de inicio y el tipo de cada vendedor.
--  * Cuenta de lunes a viernes desde la fecha de inicio (16 de noviembre de 2026), incluido hoy, y es
--    acumulativa: lo que no registraron en dias pasados se queda pendiente.
--  * Cuentan los prospectos que el vendedor registro (origen vendedor) desde el inicio, aunque luego se
--    cierren o archiven.
--  * Todos los vendedores empiezan como telemarketing hasta que la jefa diga cuales son de campo.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.prospeccion_config (
  id int primary key default 1 check (id = 1),
  meta_telemarketing int not null default 8 check (meta_telemarketing between 0 and 200),
  meta_campo int not null default 2 check (meta_campo between 0 and 200),
  inicio date not null default date '2026-11-16',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.prospeccion_config (id) values (1) on conflict do nothing;

create table if not exists public.prospeccion_vendedor (
  vendedor_id uuid primary key references public.profiles (id) on delete cascade,
  tipo text not null default 'telemarketing' check (tipo in ('telemarketing', 'campo', 'sin_meta')),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.prospeccion_config enable row level security;
alter table public.prospeccion_vendedor enable row level security;
revoke all on public.prospeccion_config, public.prospeccion_vendedor from anon, authenticated;
grant select, insert, update on public.prospeccion_config, public.prospeccion_vendedor to authenticated;
drop policy if exists prospeccion_config_select on public.prospeccion_config;
create policy prospeccion_config_select on public.prospeccion_config for select to authenticated using (public.is_active_user());
drop policy if exists prospeccion_config_write on public.prospeccion_config;
create policy prospeccion_config_write on public.prospeccion_config for all to authenticated
  using (public.is_sales_manager()) with check (public.is_sales_manager());
drop policy if exists prospeccion_vendedor_select on public.prospeccion_vendedor;
create policy prospeccion_vendedor_select on public.prospeccion_vendedor for select to authenticated
  using (vendedor_id = auth.uid() or public.is_sales_manager() or public.is_gerente());
drop policy if exists prospeccion_vendedor_write on public.prospeccion_vendedor;
create policy prospeccion_vendedor_write on public.prospeccion_vendedor for all to authenticated
  using (public.is_sales_manager()) with check (public.is_sales_manager());

-- Dias de lunes a viernes entre dos fechas (incluidas).
create or replace function public.dias_habiles(p_desde date, p_hasta date) returns int
language sql immutable as $$
  select count(*)::int from generate_series(p_desde, p_hasta, interval '1 day') d where extract(isodow from d) < 6;
$$;

-- Avance de cada vendedor. El vendedor solo se ve a si mismo; jefa, gerente y CEO ven a todos.
create or replace function public.prospeccion_avance()
returns table (vendedor_id uuid, nombre text, tipo text, meta_diaria int, inicio date, dias int, requeridos int,
  registrados int, faltan int, hoy int, meta_hoy int)
language plpgsql stable security definer set search_path = public as $$
declare
  c public.prospeccion_config;
  v_hoy date := public.local_today();
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'America/Chihuahua');
  v_todos boolean := public.is_sales_manager() or public.is_gerente();
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into c from public.prospeccion_config where id = 1;
  return query
    with v as (
      select p.id, p.nombre, coalesce(pv.tipo, 'telemarketing') as tipo
      from public.profiles p
      left join public.prospeccion_vendedor pv on pv.vendedor_id = p.id
      where p.rol = 'vendedor' and p.activo and (v_todos or p.id = auth.uid())
    ), m as (
      select v.*, case v.tipo when 'campo' then c.meta_campo when 'telemarketing' then c.meta_telemarketing else 0 end as meta,
        case when v_hoy >= c.inicio then public.dias_habiles(c.inicio, v_hoy) else 0 end as dias
      from v
    ), r as (
      select b.vendedor_id as vid,
        count(*) filter (where (b.created_at at time zone v_tz)::date >= c.inicio)::int as total,
        count(*) filter (where (b.created_at at time zone v_tz)::date = v_hoy)::int as hoy
      from public.bitacora b
      where b.origen = 'vendedor' and b.vendedor_id in (select id from v)
      group by b.vendedor_id
    )
    select m.id, m.nombre, m.tipo, m.meta, c.inicio, m.dias, m.meta * m.dias, coalesce(r.total, 0),
      greatest(m.meta * m.dias - coalesce(r.total, 0), 0), coalesce(r.hoy, 0),
      case when extract(isodow from v_hoy) < 6 and v_hoy >= c.inicio then m.meta else 0 end
    from m left join r on r.vid = m.id
    order by m.tipo, m.nombre;
end;
$$;
revoke all on function public.prospeccion_avance() from public, anon;
grant execute on function public.prospeccion_avance() to authenticated;

commit;
