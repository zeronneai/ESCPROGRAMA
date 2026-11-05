-- =============================================================================
-- 0034_folio_sac.sql   (requiere 0033 ya aplicado)
-- Folio seriado de las acciones correctivas: SAC-01, SAC-02, SAC-03... (sin el año), para llevar
-- el conteo y la rastreabilidad. Las que ya existen se renumeran en el orden en que se crearon.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create temporary table sac_folios on commit drop as
select id, numero as anterior, 'SAC-' || lpad(row_number() over (order by created_at, id)::text, 2, '0') as nuevo
  from public.acciones_correctivas;

alter table public.acciones_correctivas disable trigger user;
update public.acciones_correctivas a set numero = f.nuevo from sac_folios f where f.id = a.id and a.numero <> f.nuevo;
alter table public.acciones_correctivas enable trigger user;

-- Los eventos de la queja que mencionan el folio anterior.
alter table public.calidad_eventos disable trigger user;
update public.calidad_eventos e set nota = f.nuevo from sac_folios f where e.nota = f.anterior;
alter table public.calidad_eventos enable trigger user;

select setval('public.sac_seq', greatest((select count(*) from sac_folios), 1), (select count(*) from sac_folios) > 0);
alter table public.acciones_correctivas
  alter column numero set default ('SAC-' || lpad(nextval('public.sac_seq')::text, 2, '0'));

commit;

-- VERIFICACION:
--   select numero, fecha from public.acciones_correctivas order by created_at;   -- SAC-01, SAC-02...
