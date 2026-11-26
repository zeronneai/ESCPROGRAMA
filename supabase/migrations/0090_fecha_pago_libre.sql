-- =============================================================================
-- 0090_fecha_pago_libre.sql   (requiere 0073)
-- La fecha de pago puede ser ANTES de la fecha de la factura (a veces se factura despues de que pagan).
-- Lo unico que no se permite es una fecha futura.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.ventas_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_por text := nullif(current_setting('esc.venta_por', true), '');
begin
  if TG_OP = 'INSERT' then
    if public.is_seller() then new.vendedor_id := coalesce(v_por::uuid, auth.uid()); end if;
  else
    new.vendedor_id := old.vendedor_id;
    new.origen := old.origen;
    if old.cancelada_at is not null and new.cancelada_at is not null then
      raise exception 'Esta venta esta cancelada';
    end if;
  end if;
  if new.pago = 'contado' then new.dias_credito := null; end if;
  if new.pago = 'credito' and new.dias_credito is null then new.dias_credito := 30; end if;
  if not new.entregado then new.fecha_entrega := null;
  elsif new.fecha_entrega is null then new.fecha_entrega := public.local_today(); end if;

  if new.porcentaje_cobrado < 100 then
    new.fecha_cobro := null;
  elsif TG_OP = 'UPDATE' and old.porcentaje_cobrado >= 100 and new.fecha_cobro is null then
    -- Ya estaba pagada: conserva su fecha.
    new.fecha_cobro := old.fecha_cobro;
  elsif new.fecha_cobro is null then
    -- Recien marcada pagada: la fecha de pago la pone quien la marca.
    if TG_OP = 'UPDATE' and auth.uid() is not null then
      raise exception 'FECHA_PAGO_FALTA: Escribe la fecha en que te pagaron';
    end if;
    new.fecha_cobro := coalesce(new.fecha, public.local_today());
  end if;
  if new.fecha_cobro is not null and (TG_OP = 'INSERT' or new.fecha_cobro is distinct from old.fecha_cobro) then
    if new.fecha_cobro > public.local_today() then raise exception 'FECHA_PAGO_MAL: La fecha de pago no puede ser futura'; end if;
  end if;
  return new;
end $$;

commit;
