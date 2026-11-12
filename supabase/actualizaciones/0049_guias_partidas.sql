-- =============================================================================
-- 0049_guias_partidas.sql
-- Guias con PARTIDAS: un envio puede llevar varias tarimas o bultos distintos (cada partida con su
-- cantidad, peso, medidas y descripcion). Los totales (bultos, peso y tipo) se siguen guardando para
-- las listas; si se mezclan tarimas y bultos el tipo queda "mixto".
-- Se puede correr en cualquier momento.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.guias drop constraint if exists guias_empaque_check;
alter table public.guias add constraint guias_empaque_check check (empaque in ('bulto', 'tarima', 'mixto'));
alter table public.guias add column partidas jsonb check (
  partidas is null or (jsonb_typeof(partidas) = 'array' and jsonb_array_length(partidas) between 1 and 30
                       and octet_length(partidas::text) <= 20000));
grant insert (partidas), update (partidas) on public.guias to authenticated;

commit;
