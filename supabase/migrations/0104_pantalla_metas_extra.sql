-- =============================================================================
-- 0104_pantalla_metas_extra.sql   (requiere 0099)
-- PANTALLA DE METAS: LO QUE VA PASANDO EN VIVO
--  * Ultimas ventas (solo a quien le cuenta y la hora; sin montos ni clientes).
--  * Ultimos prospectos cerrados (ganados) y cuantos van hoy.
--  * Avance del equipo dia por dia en el periodo (en %, sin montos), para la grafica.
--  * Es para la pantalla publica (sin usuario): no trae montos, clientes ni datos personales.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.metas_pantalla_extra() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  p record;
  v_tc numeric;
  v_factor numeric;
  v_solo text[];
  v_meta numeric;
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'America/Chihuahua');
  v_ventas jsonb;
  v_cierres jsonb;
  v_diario jsonb;
  v_hoy jsonb;
begin
  select * into p from public.metas_periodo();
  v_tc := (select usd_mxn from public.tipo_cambio_para(p.hoy) limit 1);
  v_factor := (p.fin - p.ini + 1)::numeric / p.dias_mes;
  select coalesce(array_agg(public.nombre_norm(n)), '{}') into v_solo from public.metas_config c, unnest(c.solo_equipo) n where c.id = 1;
  select coalesce(sum(round(m.meta * v_factor, 2)), 0) into v_meta from public.metas_venta m where m.estado = 'activa';

  -- A quien le cuenta cada venta (como en la grafica).
  with va as (
    select x.id, x.created_at, x.fecha, x.moneda, x.subtotal, x.tipo_cambio,
      case when exists (select 1 from unnest(v_solo) n where public.nombre_norm(x.vendedor_factura) like n || '%') then 'Equipo'
        else coalesce(
          (select m2.nombre from public.metas_venta m2
            where x.vendedor_factura is not null and m2.estado = 'activa'
              and public.nombre_norm(x.vendedor_factura) in (public.nombre_norm(m2.nombre), public.nombre_norm(m2.alias_factura)) limit 1),
          (select m3.nombre from public.metas_venta m3 where m3.vendedor_id = x.vendedor_id and m3.estado = 'activa')) end as quien
    from public.ventas x
    where x.cancelada_at is null and x.fecha between p.ini and p.fin and x.subtotal is not null
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('quien', q.quien, 'at', q.created_at) order by q.created_at desc)
                from (select * from va where va.quien is not null order by va.created_at desc limit 8) q), '[]'),
    coalesce((select jsonb_agg(jsonb_build_object('fecha', d::date,
                'pct', case when v_meta > 0 then round(coalesce((select sum(case when va.moneda = 'USD' then va.subtotal * coalesce(va.tipo_cambio, v_tc, 0) else va.subtotal end)
                  from va where va.quien is not null and va.fecha <= d::date), 0) / v_meta * 100, 1) else 0 end) order by d)
                from generate_series(p.ini, least(p.hoy, p.fin), interval '1 day') d), '[]'),
    jsonb_build_object('ventas', (select count(*) from va where va.quien is not null and (va.created_at at time zone v_tz)::date = p.hoy))
    into v_ventas, v_diario, v_hoy;

  select coalesce(jsonb_agg(jsonb_build_object('quien', c.nombre, 'at', c.created_at) order by c.created_at desc), '[]') into v_cierres
    from (
      select pr.nombre, e.created_at
        from public.bitacora_eventos e
        join public.bitacora b on b.id = e.bitacora_id
        join public.profiles pr on pr.id = b.vendedor_id
       where e.tipo = 'resultado' and e.nota like 'ganada%' and e.created_at >= p.ini - 30
       order by e.created_at desc limit 8
    ) c;

  v_hoy := v_hoy || jsonb_build_object(
    'prospectos', (select count(*) from public.bitacora b where b.origen = 'vendedor' and (b.created_at at time zone v_tz)::date = p.hoy),
    'cierres', (select count(*) from public.bitacora_eventos e where e.tipo = 'resultado' and e.nota like 'ganada%' and (e.created_at at time zone v_tz)::date = p.hoy));

  return jsonb_build_object('ventas', v_ventas, 'cierres', v_cierres, 'diario', v_diario, 'hoy', v_hoy, 'ahora', now());
end;
$$;
revoke all on function public.metas_pantalla_extra() from public;
grant execute on function public.metas_pantalla_extra() to anon, authenticated;

commit;
