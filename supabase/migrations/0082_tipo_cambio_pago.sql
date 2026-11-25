-- =============================================================================
-- 0082_tipo_cambio_pago.sql   (requiere 0071 y 0073)
-- TIPO DE CAMBIO DEL PAGO (ventas en dolares):
--  * Al marcar pagada una venta en USD, el vendedor pone el tipo de cambio del dia en que le pagaron
--    (el portal le propone el de Banxico de ese dia), para saber en cuantos pesos se pago.
--  * Se guarda aparte del tipo de cambio de la factura.
--  * Si se marca pagada por Conciliaciones (sin que nadie lo escriba), se pone el de Banxico de ese dia.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.ventas
  add column if not exists tipo_cambio_pago numeric(10, 4) check (tipo_cambio_pago is null or tipo_cambio_pago between 5 and 60),
  add column if not exists tipo_cambio_pago_fuente text check (tipo_cambio_pago_fuente is null or tipo_cambio_pago_fuente in ('manual', 'banxico'));
grant update (tipo_cambio_pago) on public.ventas to authenticated;

create or replace function public.ventas_tc_pago_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.moneda <> 'USD' or new.porcentaje_cobrado < 100 then
    new.tipo_cambio_pago := null;
    new.tipo_cambio_pago_fuente := null;
  elsif new.tipo_cambio_pago is null then
    new.tipo_cambio_pago := (select usd_mxn from public.tipo_cambio_para(coalesce(new.fecha_cobro, public.local_today())) limit 1);
    new.tipo_cambio_pago_fuente := case when new.tipo_cambio_pago is null then null else 'banxico' end;
  elsif tg_op = 'INSERT' or new.tipo_cambio_pago is distinct from old.tipo_cambio_pago then
    new.tipo_cambio_pago_fuente := 'manual';
  end if;
  return new;
end;
$$;
drop trigger if exists ventas_tc_pago on public.ventas;
create trigger ventas_tc_pago before insert or update of porcentaje_cobrado, fecha_cobro, tipo_cambio_pago, moneda on public.ventas
  for each row execute function public.ventas_tc_pago_trg();

-- Ventas en USD que ya estaban pagadas: el de Banxico del dia del pago.
update public.ventas set tipo_cambio_pago = null where moneda = 'USD' and porcentaje_cobrado >= 100 and tipo_cambio_pago is null;

commit;
