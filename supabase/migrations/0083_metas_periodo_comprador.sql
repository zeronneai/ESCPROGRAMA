-- =============================================================================
-- 0083_metas_periodo_comprador.sql   (requiere 0081)
-- El comprador tambien puede cambiar desde/hasta que dia cuentan las metas (periodo proporcional).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

drop policy if exists metas_config_select on public.metas_config;
create policy metas_config_select on public.metas_config for select to authenticated
  using (public.is_sales_manager() or public.is_gerente() or public.is_buyer());
drop policy if exists metas_config_update on public.metas_config;
create policy metas_config_update on public.metas_config for update to authenticated
  using (public.is_sales_manager() or public.is_buyer()) with check (public.is_sales_manager() or public.is_buyer());

commit;
