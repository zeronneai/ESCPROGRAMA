-- =============================================================================
-- 0101_metas_revision_facturas.sql   (requiere 0099)
-- REVISAR A QUIEN LE CUENTA CADA FACTURA EN LAS METAS
--  * Para el comprador, la jefa de ventas y la gerente: cada factura del periodo de metas con el
--    vendedor que se leyo de la factura y a que meta va (o "Solo equipo", como Ivan Munoz).
--  * Solo consulta; no cambia nada.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.metas_revision_facturas()
returns table (id uuid, factura text, fecha date, subio text, vendedor_factura text, cuenta_para text, solo_equipo boolean,
  subtotal numeric, moneda text, tiene_pdf boolean, tiene_xml boolean)
language plpgsql stable security definer set search_path = public as $$
declare p record; v_solo text[];
begin
  if not (public.is_buyer() or public.is_sales_manager() or public.is_gerente()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into p from public.metas_periodo();
  select coalesce(array_agg(public.nombre_norm(n)), '{}') into v_solo from public.metas_config c, unnest(c.solo_equipo) n where c.id = 1;
  return query
    select x.id, x.factura, x.fecha, pr.nombre, x.vendedor_factura,
      case when exists (select 1 from unnest(v_solo) n where public.nombre_norm(x.vendedor_factura) like n || '%') then 'Solo equipo'
        else coalesce(
          (select m2.nombre from public.metas_venta m2
            where x.vendedor_factura is not null
              and public.nombre_norm(x.vendedor_factura) in (public.nombre_norm(m2.nombre), public.nombre_norm(m2.alias_factura))
            order by (m2.estado = 'activa') desc limit 1),
          (select m3.nombre from public.metas_venta m3 where m3.vendedor_id = x.vendedor_id),
          '(sin meta)') end,
      exists (select 1 from unnest(v_solo) n where public.nombre_norm(x.vendedor_factura) like n || '%'),
      x.subtotal, x.moneda::text, x.factura_path is not null, x.xml_path is not null
    from public.ventas x
    left join public.profiles pr on pr.id = x.vendedor_id
    where x.cancelada_at is null and x.fecha between p.ini and p.fin
    order by x.fecha desc, x.factura desc;
end;
$$;
revoke all on function public.metas_revision_facturas() from public, anon;
grant execute on function public.metas_revision_facturas() to authenticated;

commit;
