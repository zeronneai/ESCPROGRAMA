-- =============================================================================
-- 0096_previo_finanzas.sql   (requiere 0089)
-- FINANZAS TAMBIEN IDENTIFICA PAGOS DE FACTURAS ANTERIORES AL PORTAL
--  * Pagos que llegan ahora pero de facturas de antes de noviembre (que nunca se van a subir al portal):
--    la auxiliar (o supervisora) de finanzas le da "Identificar" y pone solo los folios.
--  * Queda igual que "Identificado antes del portal": ya no se toca.
--  * Finanzas puede deshacer solo los que ella marco; la jefa, la gerente, el CEO y el comprador, todos.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.puede_marcar_previo() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_sales_manager() or public.is_gerente() or public.is_buyer() or public.is_finanzas();
$$;

create or replace function public.conciliacion_marcar_previo(p_mov uuid, p_folios text[], p_nota text default null, p_para text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.puede_marcar_previo() then raise exception 'Solo finanzas, la jefa de ventas, la gerente, el CEO o el comprador' using errcode = '42501'; end if;
  if public.is_finanzas() and coalesce(array_length(p_folios, 1), 0) = 0 then raise exception 'Pon los folios de las facturas'; end if;
  n := public.conciliacion_previo_aplicar(p_mov, p_folios, p_nota, p_para, auth.uid());
  perform public.conciliacion_previo_recepcion(p_mov, auth.uid());
  return n;
end;
$$;

create or replace function public.conciliacion_quitar_previo(p_mov uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_sales_manager() or public.is_gerente() or public.is_buyer()
          or (public.is_finanzas() and exists (select 1 from public.conciliacion_movimientos m where m.id = p_mov and m.previo_por = auth.uid()))) then
    raise exception 'Solo quien lo marcó (o la jefa, la gerente, el CEO o el comprador) lo puede deshacer' using errcode = '42501';
  end if;
  perform set_config('esc.previo', 'on', true);
  delete from public.conciliacion_facturas where movimiento_id = p_mov;
  update public.conciliacion_movimientos
     set previo = false, previo_nota = null, previo_por = null, previo_at = null,
         tomado_por = null, tomado_at = null, tomado_nombre = null, tomado_para = null, vendedor_id = null, tardio = false
   where id = p_mov and previo;
  perform set_config('esc.previo', 'off', true);
end;
$$;

commit;
