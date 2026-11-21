-- =============================================================================
-- 0065_prospeccion_pausa_jefa_factura.sql   (requiere 0050 y 0055)
-- 1) PROSPECCION EN PAUSA: el vendedor (o la jefa) pone en pausa un prospecto despues de varios intentos.
--    Mientras esta en pausa no hay fecha de seguimiento, asi que no cuenta como atrasado en ningun lado.
--    Al reanudar regresa la fecha de seguimiento que tenia (o hoy si ya paso).
-- 2) LA JEFA SUBE FACTURAS POR UN VENDEDOR: con venta_desde_factura_por(datos, vendedor) la venta queda a
--    nombre del vendedor elegido (cuenta en sus ventas y cierra su prospeccion). Para vacaciones, etc.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- 1) Pausa en la prospeccion
alter table public.bitacora
  add column if not exists pausada_at timestamptz,
  add column if not exists pausa_motivo text check (pausa_motivo is null or length(pausa_motivo) <= 300),
  add column if not exists pausa_seguimiento date;

create or replace function public.bitacora_pausa(p_id uuid, p_pausar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bitacora;
begin
  select * into b from public.bitacora where id = p_id for update;
  if not found then raise exception 'Registro no encontrado'; end if;
  if not ((public.is_seller() and b.vendedor_id = auth.uid()) or public.is_sales_manager()) then
    raise exception 'Solo el vendedor del prospecto o la jefa de ventas' using errcode = '42501';
  end if;
  if p_pausar then
    if b.pausada_at is not null then return; end if;
    update public.bitacora
       set pausada_at = now(), pausa_motivo = nullif(left(trim(coalesce(p_motivo, '')), 300), ''),
           pausa_seguimiento = proximo_seguimiento, proximo_seguimiento = null
     where id = p_id;
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    values (p_id, 'comentario', 'En pausa' || coalesce(': ' || nullif(trim(coalesce(p_motivo, '')), ''), ''), auth.uid());
  else
    if b.pausada_at is null then return; end if;
    update public.bitacora
       set proximo_seguimiento = case when pausa_seguimiento is null then null else greatest(pausa_seguimiento, public.local_today()) end,
           pausada_at = null, pausa_motivo = null, pausa_seguimiento = null
     where id = p_id;
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    values (p_id, 'comentario', 'Se reanudó el seguimiento', auth.uid());
  end if;
end $$;
revoke all on function public.bitacora_pausa(uuid, boolean, text) from public, anon;
grant execute on function public.bitacora_pausa(uuid, boolean, text) to authenticated;

-- Si estando en pausa le ponen fecha de seguimiento, se reanuda solo.
create or replace function public.bitacora_pausa_auto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pausada_at is not null and old.pausada_at is not null and new.proximo_seguimiento is not null and old.proximo_seguimiento is null then
    new.pausada_at := null; new.pausa_motivo := null; new.pausa_seguimiento := null;
  end if;
  return new;
end $$;
drop trigger if exists bitacora_pausa_auto on public.bitacora;
create trigger bitacora_pausa_auto before update on public.bitacora for each row execute function public.bitacora_pausa_auto();

-- 2) Venta a nombre de otro vendedor (solo la jefa, dentro de venta_desde_factura_por).
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
  if new.porcentaje_cobrado >= 100 and new.fecha_cobro is null then new.fecha_cobro := public.local_today(); end if;
  if new.porcentaje_cobrado < 100 then new.fecha_cobro := null; end if;
  return new;
end $$;

create or replace function public.venta_desde_factura_por(p jsonb, p_vendedor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and rol = 'jefe_ventas') then
    raise exception 'Solo la jefa de ventas sube facturas por otro vendedor' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_vendedor and rol in ('vendedor', 'jefe_ventas') and activo) then
    raise exception 'Vendedor no encontrado';
  end if;
  perform set_config('esc.venta_por', p_vendedor::text, true);
  v := public.venta_desde_factura(p);
  perform set_config('esc.venta_por', '', true);
  if p_vendedor <> auth.uid() then
    perform public.notify_user(p_vendedor, 'venta_por_jefa', 'Se registró una venta a tu nombre',
      'Factura ' || upper(trim(p ->> 'folio')) || ' · la subió ' || public.my_name(),
      '/vendedor/bitacora/venta/' || (v ->> 'venta_id'), (v ->> 'venta_id')::uuid);
  end if;
  return v;
end $$;
revoke all on function public.venta_desde_factura_por(jsonb, uuid) from public, anon;
grant execute on function public.venta_desde_factura_por(jsonb, uuid) to authenticated;
commit;
