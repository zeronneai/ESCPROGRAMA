-- =============================================================================
-- 0085_recepcion_gerente_prospectos_clientes.sql   (requiere 0070 y 0079)
--  * Recepcion de facturas: la gerente y el CEO tambien la ven por vendedor (solo consulta).
--  * Meta de prospeccion: ademas de cuantos debio registrar y cuantos registro, cuantos de esos ya
--    se hicieron clientes (cerraron venta con factura).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- Recepcion de facturas: la gerente y el CEO tambien la consultan (solo ver, como la jefa).
drop policy if exists factura_entregas_select on public.factura_entregas;
create policy factura_entregas_select on public.factura_entregas for select to authenticated
  using (vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager() or public.is_gerente());
drop policy if exists cobro_pagos_select on public.cobro_pagos;
create policy cobro_pagos_select on public.cobro_pagos for select to authenticated
  using (vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager() or public.is_gerente());
drop policy if exists factura_recepcion_select on public.factura_recepcion;
create policy factura_recepcion_select on public.factura_recepcion for select to authenticated
  using (vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager() or public.is_gerente());
drop policy if exists factura_entrega_notas_select on public.factura_entrega_notas;
create policy factura_entrega_notas_select on public.factura_entrega_notas for select to authenticated
  using (exists (select 1 from public.factura_entregas e where e.id = entrega_id
                  and (e.vendedor_id = auth.uid() or public.is_finanzas() or public.is_sales_manager() or public.is_gerente())));

create or replace function public.finanzas_vendedores() returns table (id uuid, nombre text, por_revisar integer, recibidas integer, rechazadas integer, ultima timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre,
         count(*) filter (where r.estado = 'por_revisar')::int,
         count(*) filter (where r.estado = 'recibida')::int,
         count(*) filter (where r.estado = 'rechazada')::int,
         max(r.created_at)
    from public.profiles p join public.factura_recepcion r on r.vendedor_id = p.id
   where public.is_finanzas() or public.is_sales_manager() or public.is_gerente()
   group by p.id, p.nombre
   order by count(*) filter (where r.estado = 'por_revisar') desc, p.nombre;
$$;
grant execute on function public.finanzas_vendedores() to authenticated;

-- Prospeccion: cuantos de los registrados ya son clientes.
-- Avance de cada vendedor. El vendedor solo se ve a si mismo; jefa, gerente y CEO ven a todos.
drop function if exists public.prospeccion_avance();
create or replace function public.prospeccion_avance()
returns table (vendedor_id uuid, nombre text, tipo text, meta_diaria int, inicio date, dias int, requeridos int,
  registrados int, faltan int, hoy int, meta_hoy int, convertidos int)
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
        count(*) filter (where (b.created_at at time zone v_tz)::date = v_hoy)::int as hoy,
        count(*) filter (where (b.created_at at time zone v_tz)::date >= c.inicio and b.resultado = 'ganada')::int as ganadas
      from public.bitacora b
      where b.origen = 'vendedor' and b.vendedor_id in (select id from v)
      group by b.vendedor_id
    )
    select m.id, m.nombre, m.tipo, m.meta, c.inicio, m.dias, m.meta * m.dias, coalesce(r.total, 0),
      greatest(m.meta * m.dias - coalesce(r.total, 0), 0), coalesce(r.hoy, 0),
      case when extract(isodow from v_hoy) < 6 and v_hoy >= c.inicio then m.meta else 0 end,
      coalesce(r.ganadas, 0)
    from m left join r on r.vid = m.id
    order by m.tipo, m.nombre;
end;
$$;
revoke all on function public.prospeccion_avance() from public, anon;
grant execute on function public.prospeccion_avance() to authenticated;

commit;
