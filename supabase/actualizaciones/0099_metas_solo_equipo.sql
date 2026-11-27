-- =============================================================================
-- 0099_metas_solo_equipo.sql   (requiere 0086)
-- FACTURAS DE IVAN MUNOZ: SOLO CUENTAN PARA EL EQUIPO
--  * Las facturas que en "Vendedor" dicen IVAN MUÑOZ (ya no esta) no cuentan en la meta de quien las
--    subio; si se suman al total del EQUIPO.
--  * Solo cambia la grafica de metas. Pagos, comisiones, recepcion de facturas y todo lo demas sigue
--    igual (con quien las subio).
--  * La lista de nombres esta en metas_config.solo_equipo (se pueden agregar otros). Cuenta tambien si
--    la factura trae el nombre completo (ej. IVAN MUÑOZ GARCIA).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.metas_config add column if not exists solo_equipo text[] not null default array['IVAN MUÑOZ'];
update public.metas_config set solo_equipo = array['IVAN MUÑOZ'] where id = 1 and solo_equipo = '{}';

drop function if exists public.metas_ventas_avance(date);
drop function if exists public.metas_ventas_publico(text);
drop function if exists public.metas_calculo(uuid, boolean);

create or replace function public.metas_calculo(p_uid uuid, p_ver boolean)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean,
  meta_mes numeric, desde date, hasta date, equipo_extra numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  p record;
  v_tc numeric;
  v_factor numeric;
  v_dias int;
  v_dia int;
  v_solo text[];
  v_extra numeric;
begin
  select * into p from public.metas_periodo();
  v_tc := (select usd_mxn from public.tipo_cambio_para(p.hoy) limit 1);
  v_dias := p.fin - p.ini + 1;
  v_factor := v_dias::numeric / p.dias_mes;
  v_dia := greatest(0, least(v_dias, p.hoy - p.ini + 1));
  select coalesce(array_agg(public.nombre_norm(n)), '{}') into v_solo from public.metas_config c, unnest(c.solo_equipo) n where c.id = 1;
  -- Ventas de vendedores que ya no estan: solo al total del equipo.
  select coalesce(sum(case when x.moneda = 'USD' then x.subtotal * coalesce(x.tipo_cambio, v_tc, 0) else x.subtotal end), 0) into v_extra
    from public.ventas x
   where x.cancelada_at is null and x.fecha between p.ini and p.fin and x.subtotal is not null
     and exists (select 1 from unnest(v_solo) n where public.nombre_norm(x.vendedor_factura) like n || '%');
  return query
    with va as (
      -- Cada venta va a la meta del vendedor que dice la factura (ej. CASA LOCAL); si no se reconoce, a la de quien la subio.
      select x.*, coalesce(
        (select m2.id from public.metas_venta m2
          where x.vendedor_factura is not null
            and public.nombre_norm(x.vendedor_factura) in (public.nombre_norm(m2.nombre), public.nombre_norm(m2.alias_factura))
          order by (m2.estado = 'activa') desc limit 1),
        (select m3.id from public.metas_venta m3 where m3.vendedor_id = x.vendedor_id)) as meta_id
      from public.ventas x
      where x.cancelada_at is null and x.fecha between p.ini and p.fin and x.subtotal is not null
        and not exists (select 1 from unnest(v_solo) n where public.nombre_norm(x.vendedor_factura) like n || '%')
    ), s as (
      select va.meta_id,
        sum(case when va.moneda = 'USD' then va.subtotal * coalesce(va.tipo_cambio, v_tc, 0) else va.subtotal end) as total,
        count(*)::int as n,
        count(*) filter (where va.moneda = 'USD' and va.tipo_cambio is null and v_tc is null)::int as sin_tc
      from va where va.meta_id is not null
      group by va.meta_id
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
      left join s on s.meta_id = m.id
      left join cap on cap.meta_id = m.id
      where m.estado = 'activa'
    )
    select m.id, m.nombre, case when p_uid is null then null else m.vendedor_id end,
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then m.meta_p end,
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then round(m.total, 2) end,
      round(m.total / nullif(m.meta_p, 0) * 100, 1),
      m.n, m.sin_tc, p.ini, v_dia, v_dias,
      coalesce(m.vendedor_id = p_uid, false),
      round((sum(m.total) over () + v_extra) / nullif(sum(m.meta_p) over (), 0) * 100, 1),
      coalesce(m.capturista_id = p_uid, false),
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then m.meta end,
      p.ini, p.fin,
      case when p_ver then round(v_extra, 2) end
    from t m
    order by m.total / nullif(m.meta_p, 0) desc nulls last, m.orden, m.nombre;
end;
$$;
revoke all on function public.metas_calculo(uuid, boolean) from public, anon, authenticated;

create or replace function public.metas_ventas_avance(p_mes date default null)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean,
  meta_mes numeric, desde date, hasta date, equipo_extra numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_seller() or public.is_gerente() or public.is_buyer()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query select * from public.metas_calculo(auth.uid(), public.is_sales_manager() or public.is_gerente());
end;
$$;
revoke all on function public.metas_ventas_avance(date) from public, anon;
grant execute on function public.metas_ventas_avance(date) to authenticated;

create or replace function public.metas_ventas_publico(p_token text default null)
returns table (id uuid, nombre text, vendedor_id uuid, meta numeric, vendido numeric, pct numeric, ventas int,
  usd_sin_tc int, mes date, dia int, dias_mes int, es_mio boolean, equipo_pct numeric, capturo boolean,
  meta_mes numeric, desde date, hasta date, equipo_extra numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query select * from public.metas_calculo(null, false);
end;
$$;
revoke all on function public.metas_ventas_publico(text) from public;
grant execute on function public.metas_ventas_publico(text) to anon, authenticated;

commit;
