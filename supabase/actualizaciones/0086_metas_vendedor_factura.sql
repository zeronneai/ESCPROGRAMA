-- =============================================================================
-- 0086_metas_vendedor_factura.sql   (requiere 0081)
-- METAS POR EL VENDEDOR QUE DICE LA FACTURA:
--  * Cada venta guarda el vendedor que viene impreso en la factura (Microsip), por ejemplo CASA LOCAL.
--  * En las graficas de metas cada factura cuenta para la meta de ese vendedor, aunque la haya subido
--    otra persona. Si el nombre de la factura no corresponde a ninguna meta, cuenta para quien la subio.
--  * Cada meta tiene su "nombre en la factura" (como sale en Microsip); si no se pone, se usa su nombre.
--  * Casa Local se activa (VTS Cd Juarez sigue en pausa, pero sus facturas ya no se le cuentan a nadie mas).
--  * Las facturas que ya estaban: se toma el vendedor de almacen cuando se registro ahi; las demas se leen
--    con el boton "Leer datos de las facturas" en Configurar metas.
--  * Solo cambia las metas: el resto del portal sigue por quien subio la venta.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.ventas add column if not exists vendedor_factura text check (vendedor_factura is null or length(vendedor_factura) <= 150);
alter table public.metas_venta add column if not exists alias_factura text check (alias_factura is null or length(alias_factura) <= 150);

-- Nombre comparable: mayusculas, sin acentos ni espacios dobles.
create or replace function public.nombre_norm(p text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(upper(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ.', 'aeiouunAEIOUUN ')), '\s+', ' ', 'g')), '');
$$;

-- El portal manda el vendedor que leyo de la factura.
create or replace function public.venta_vendedor_factura(p_venta uuid, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.ventas;
begin
  select * into v from public.ventas where id = p_venta;
  if v.id is null then raise exception 'Venta no encontrada'; end if;
  if not (v.vendedor_id = auth.uid() or public.is_sales_manager()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.ventas set vendedor_factura = nullif(left(trim(coalesce(p_nombre, '')), 150), '') where id = p_venta;
end;
$$;
revoke all on function public.venta_vendedor_factura(uuid, text) from public, anon;
grant execute on function public.venta_vendedor_factura(uuid, text) to authenticated;

-- Las que ya estaban y pasaron por almacen: su vendedor de la factura.
update public.ventas v set vendedor_factura = s.vendedor_factura
  from public.salidas s where s.venta_id = v.id and v.vendedor_factura is null and s.vendedor_factura is not null;

update public.metas_venta set alias_factura = 'CASA LOCAL', estado = 'activa' where public.nombre_norm(nombre) = 'CASA LOCAL' and alias_factura is null;
update public.metas_venta set alias_factura = 'VTS CD JUAREZ' where public.nombre_norm(nombre) in ('VTS CD JUAREZ', 'VTS CD. JUAREZ') and alias_factura is null;

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
      round(sum(m.total) over () / nullif(sum(m.meta_p) over (), 0) * 100, 1),
      coalesce(m.capturista_id = p_uid, false),
      case when p_ver or (p_uid is not null and (m.vendedor_id = p_uid or m.capturista_id = p_uid)) then m.meta end,
      p.ini, p.fin
    from t m
    order by m.total / nullif(m.meta_p, 0) desc nulls last, m.orden, m.nombre;
end;
$$;
revoke all on function public.metas_calculo(uuid, boolean) from public, anon, authenticated;

-- Que la grafica se refresque cuando se lea el vendedor de una factura.
drop trigger if exists ventas_pulso on public.ventas;
create trigger ventas_pulso after insert or update of monto, subtotal, moneda, fecha, cancelada_at, vendedor_id, tipo_cambio, vendedor_factura or delete on public.ventas
  for each statement execute function public.ventas_pulso_trg();

commit;
