-- =============================================================================
-- 0056_comprador_pide_guias.sql
-- El comprador tambien puede pedir guias a Marketplaces (por ejemplo para mandar muestras,
-- devoluciones a proveedor o material a un cliente) y descargar el archivo cuando este lista.
-- Se puede correr en cualquier momento (despues de 0055).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

drop policy if exists guias_insert on public.guias;
create policy guias_insert on public.guias for insert to authenticated
  with check (public.is_seller() or public.is_buyer());

drop policy if exists guias_update on public.guias;
create policy guias_update on public.guias for update to authenticated
  using ((public.is_seller() or public.is_buyer()) and vendedor_id = auth.uid() and estado in ('solicitada', 'requiere_datos'))
  with check (vendedor_id = auth.uid());

commit;
