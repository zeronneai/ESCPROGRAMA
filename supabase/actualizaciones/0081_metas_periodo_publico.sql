-- =============================================================================
-- 0081_metas_periodo_publico.sql   (requiere 0080)
-- METAS: PERIODO PROPORCIONAL Y PANTALLA PUBLICA
--  * La jefa de ventas elige desde que dia (y opcional hasta que dia) cuenta el mes. La meta mensual se
--    ajusta en proporcion a los dias: del 16 al 30 de noviembre son 15 de 30 dias = 50% de la meta.
--    Empieza contando desde el 16 de noviembre de 2026.
--  * Al cambiar de mes se toma solo el mes nuevo completo (del 1 al ultimo dia), sin tocar nada.
--  * Link publico (sin usuario) para las pantallas: solo nombres y porcentajes, sin montos; se
--    actualiza en tiempo real. La jefa puede cambiar el link cuando quiera (el anterior deja de abrir).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.metas_config (
  id int primary key default 1 check (id = 1),
  desde date default date '2026-11-16',
  hasta date,
  token text not null default (md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text)),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (hasta is null or desde is null or hasta >= desde)
);
insert into public.metas_config (id) values (1) on conflict do nothing;
alter table public.metas_config enable row level security;
revoke all on public.metas_config from anon, authenticated;
grant select, update on public.metas_config to authenticated;
drop policy if exists metas_config_select on public.metas_config;
create policy metas_config_select on public.metas_config for select to authenticated using (public.is_sales_manager() or public.is_gerente());
drop policy if exists metas_config_update on public.metas_config;
create policy metas_config_update on public.metas_config for update to authenticated using (public.is_sales_manager()) with check (public.is_sales_manager());

-- Periodo que se esta midiendo: el mes de hoy, recortado por "desde" y "hasta" si caen dentro de ese mes.
create or replace function public.metas_periodo(out ini date, out fin date, out dias_mes int, out hoy date)
language plpgsql stable security definer set search_path = public as $$
declare c public.metas_config; v_mi date; v_mf date;
begin
  hoy := public.local_today();
  v_mi := date_trunc('month', hoy)::date;
  v_mf := (date_trunc('month', hoy) + interval '1 month - 1 day')::date;
  select * into c from public.metas_config where id = 1;
  ini := case when c.desde is not null and c.desde between v_mi and v_mf then c.desde else v_mi end;
  fin := case when c.hasta is not null and c.hasta between ini and v_mf then c.hasta else v_mf end;
  dias_mes := extract(day from v_mf)::int;
end;
$$;

-- Calculo comun (no se llama directo).
create or replace function public.metas_calculo(p_uid uuid, p_ver boolean)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean,
  meta_mes numeric, desde date, hasta date)
language plpgsql stable security definer set search_path = public as $$
declare
  p record;
  v_tc numeric;
  v_factor numeric;
  v_dias int;
  v_dia int;
begin
  select * into p from public.metas_periodo();
  v_tc := (select usd_mxn from public.tipo_cambio_para(p.hoy) limit 1);
  v_dias := p.fin - p.ini + 1;
  v_factor := v_dias::numeric / p.dias_mes;
  v_dia := greatest(0, least(v_dias, p.hoy - p.ini + 1));
  return query
    with s as (
      select x.vendedor_id as vid,
        sum(case when x.moneda = 'USD' then x.subtotal * coalesce(x.tipo_cambio, v_tc, 0) else x.subtotal end) as total,
        count(*)::int as n,
        count(*) filter (where x.moneda = 'USD' and x.tipo_cambio is null and v_tc is null)::int as sin_tc
      from public.ventas x
      where x.cancelada_at is null and x.fecha between p.ini and p.fin and x.subtotal is not null
      group by x.vendedor_id
    ), cap as (
      select c.meta_id,
        sum(case when c.moneda = 'USD' then c.subtotal * coalesce(c.tipo_cambio, (select usd_mxn from public.tipo_cambio_para(c.fecha) limit 1), v_tc, 0) else c.subtotal end) as total,
        count(*)::int as n
      from public.metas_venta_capturas c
      where c.cancelada_at is null and c.fecha between p.ini and p.fin
      group by c.meta_id
    ), t as (
      select m.*, round(m.meta * v_factor, 2) as meta_p, coalesce(s.total, 0) + coalesce(cap.total, 0) as total,
        coalesce(s.n, 0) + coalesce(cap.n, 0) as n, coalesce(s.sin_tc, 0) as sin_tc
      from public.metas_venta m
      left join s on s.vid = m.vendedor_id
      left join cap on cap.meta_id = m.id
      where m.estado = 'activa'
    )
    select m.id, m.nombre, case when p_uid is null then null else m.vendedor_id end,
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then m.meta_p end,
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then round(m.total, 2) end,
      round(m.total / nullif(m.meta_p, 0) * 100, 1),
      m.n, m.sin_tc, p.ini, v_dia, v_dias,
      coalesce(m.vendedor_id = p_uid, false),
      round(sum(m.total) over () / nullif(sum(m.meta_p) over (), 0) * 100, 1),
      coalesce(m.capturista_id = p_uid, false),
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then m.meta end,
      p.ini, p.fin
    from t m
    order by m.total / nullif(m.meta_p, 0) desc nulls last, m.orden, m.nombre;
end;
$$;
revoke all on function public.metas_calculo(uuid, boolean) from public, anon, authenticated;

-- Portal (con usuario).
drop function if exists public.metas_ventas_avance(date);
create or replace function public.metas_ventas_avance(p_mes date default null)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean,
  meta_mes numeric, desde date, hasta date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_seller() or public.is_gerente() or public.is_buyer()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query select * from public.metas_calculo(auth.uid(), public.is_sales_manager() or public.is_gerente());
end;
$$;
revoke all on function public.metas_ventas_avance(date) from public, anon;
grant execute on function public.metas_ventas_avance(date) to authenticated;

-- Pantallas (sin usuario, con el link): solo porcentajes.
create or replace function public.metas_ventas_publico(p_token text)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean,
  meta_mes numeric, desde date, hasta date)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or length(p_token) < 32 or not exists (select 1 from public.metas_config where token = p_token) then
    raise exception 'Link no valido' using errcode = '42501';
  end if;
  return query select * from public.metas_calculo(null, false);
end;
$$;
revoke all on function public.metas_ventas_publico(text) from public;
grant execute on function public.metas_ventas_publico(text) to anon, authenticated;

-- La pantalla publica escucha el pulso de ventas en tiempo real (solo trae una hora, ningun dato).
grant select on public.ventas_pulso to anon;
drop policy if exists ventas_pulso_publico on public.ventas_pulso;
create policy ventas_pulso_publico on public.ventas_pulso for select to anon using (true);
drop trigger if exists metas_config_pulso on public.metas_config;
create trigger metas_config_pulso after update on public.metas_config for each statement execute function public.ventas_pulso_trg();

commit;
