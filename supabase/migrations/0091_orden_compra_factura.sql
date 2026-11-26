-- =============================================================================
-- 0091_orden_compra_factura.sql   (requiere 0053)
-- ORDEN DE COMPRA DEL CLIENTE EN LA FACTURA (Pegatron):
--  * Al subir una factura el portal lee la "Orden de compra" impresa (ej. 0900512429) y la guarda en la venta.
--  * En Pedidos Pegatron, cada P/O muestra si ya se facturo (folio, fecha e importe).
--  * Las facturas de Pegatron ya subidas se leen con "Leer datos de las facturas".
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.ventas add column if not exists orden_compra text check (orden_compra is null or length(orden_compra) <= 40);

-- Para comparar P/O: solo letras y numeros, sin ceros a la izquierda.
create or replace function public.po_norm(p text) returns text
language sql immutable as $$
  select nullif(ltrim(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '0'), '');
$$;
create index if not exists ventas_orden_compra_idx on public.ventas (public.po_norm(orden_compra)) where orden_compra is not null;

create or replace function public.venta_orden_compra(p_venta uuid, p_oc text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.ventas;
begin
  select * into v from public.ventas where id = p_venta;
  if v.id is null then raise exception 'Venta no encontrada'; end if;
  if not (v.vendedor_id = auth.uid() or public.is_sales_manager() or public.is_buyer()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.ventas set orden_compra = nullif(left(trim(coalesce(p_oc, '')), 40), '') where id = p_venta;
end;
$$;
revoke all on function public.venta_orden_compra(uuid, text) from public, anon;
grant execute on function public.venta_orden_compra(uuid, text) to authenticated;

-- Facturas de cada P/O de Pegatron (para Pedidos Pegatron).
create or replace function public.pegatron_facturado()
returns table (oc_id uuid, po_numero text, venta_id uuid, factura text, fecha date, moneda text, total numeric, subtotal numeric)
language sql stable security definer set search_path = public as $$
  select o.id, o.po_numero, v.id, v.factura, v.fecha, v.moneda::text, v.monto, v.subtotal
    from public.pegatron_oc o
    join public.ventas v on public.po_norm(o.po_numero) in (public.po_norm(v.orden_compra), public.po_norm(v.pedido))
   where v.cancelada_at is null and v.tipo = 'venta'
     and (public.is_sales_manager() or public.is_buyer() or public.is_gerente())
   order by v.fecha;
$$;
revoke all on function public.pegatron_facturado() from public, anon;
grant execute on function public.pegatron_facturado() to authenticated;

-- Busca la P/O de Pegatron al subir una factura (para avisar "pedido encontrado").
create or replace function public.pegatron_buscar_po(p_po text)
returns table (id uuid, folio text, po_numero text)
language sql stable security definer set search_path = public as $$
  select o.id, o.folio, o.po_numero from public.pegatron_oc o
   where public.po_norm(o.po_numero) = public.po_norm(p_po) and public.is_active_user()
   limit 1;
$$;
revoke all on function public.pegatron_buscar_po(text) from public, anon;
grant execute on function public.pegatron_buscar_po(text) to authenticated;

commit;
