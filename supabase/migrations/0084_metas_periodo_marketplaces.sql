-- =============================================================================
-- 0084_metas_periodo_marketplaces.sql   (requiere 0083)
-- Marketplaces tambien puede cambiar desde/hasta que dia cuentan las metas (como la jefa y el comprador).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

drop policy if exists metas_config_select on public.metas_config;
create policy metas_config_select on public.metas_config for select to authenticated
  using (public.is_sales_manager() or public.is_gerente() or public.is_buyer() or public.is_marketplaces());
drop policy if exists metas_config_update on public.metas_config;
create policy metas_config_update on public.metas_config for update to authenticated
  using (public.is_sales_manager() or public.is_buyer() or public.is_marketplaces())
  with check (public.is_sales_manager() or public.is_buyer() or public.is_marketplaces());

commit;
