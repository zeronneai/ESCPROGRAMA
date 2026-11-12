-- =============================================================================
-- 0051_guias_moneda.sql
-- Guias: moneda del valor declarado (MXN o USD). Al llenar la guia con una factura en dolares,
-- el valor declarado queda en USD. Se puede correr en cualquier momento.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.guias add column valor_moneda text not null default 'MXN' check (valor_moneda in ('MXN', 'USD'));
grant insert (valor_moneda), update (valor_moneda) on public.guias to authenticated;

commit;
