-- =============================================================================
-- 0007_vigencia_revisiones.sql
-- Que hace: vigencia de cotizaciones (valid_until, configurable) y revisiones versionadas.
--   * app_settings.vigencia_dias (default 15) y valid_until automatico en cada version nueva.
--   * Respalda valid_until de las cotizaciones que ya existian (una sola vez, dentro de una
--     transaccion, con verificacion de que el bloqueo de edicion quede activo y registro en
--     la bitacora).
--   * item_update_requests: solicitudes de actualizacion del vendedor (plazo de 48 horas
--     habiles para el comprador).
--   * Reemplaza guards (item_costs, item_quotes, quote_items), respond_item (acciones nuevas
--     "confirm" y "update_cost") y mark_item_dispatched (bloquea si la vigencia vencio).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0006_estados_nuevos.sql (ejecutada antes, aparte).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Configuracion de vigencia
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists vigencia_dias integer not null default 15
  check (vigencia_dias between 1 and 365);
grant update (vigencia_dias) on public.app_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Respaldo de valid_until (excepcion unica al bloqueo de item_quotes)
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.item_quotes where valid_until is null;
  perform public.write_audit('backfill_valid_until', 'item_quotes', null, null,
    jsonb_build_object('filas', v_n, 'migracion', '0007_vigencia_revisiones'),
    jsonb_build_object('nota', 'Respaldo unico de valid_until; el bloqueo se desactivo y reactivo dentro de una transaccion'));
end $$;

alter table public.item_quotes disable trigger item_quotes_locked;
update public.item_quotes
   set valid_until = quoted_at + make_interval(days => (select vigencia_dias from public.app_settings))
 where valid_until is null;
alter table public.item_quotes enable trigger item_quotes_locked;

-- Verificacion: si el bloqueo no quedo activo, se revierte TODO.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.item_quotes'::regclass and tgname = 'item_quotes_locked' and tgenabled = 'O'
  ) then
    raise exception 'El bloqueo item_quotes_locked NO esta activo: se revierte la migracion 0007';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Solicitudes de actualizacion (revision de una cotizacion vencida)
-- ---------------------------------------------------------------------------
create table public.item_update_requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.quote_items (id),
  quote_version smallint not null,            -- version que se pide actualizar
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  nota text,
  due_at timestamptz not null,                -- 48 horas habiles desde requested_at (lo calcula el servidor)
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  resolved_version smallint,
  resolution text check (resolution in ('sin_cambios', 'actualizado')),
  response_business_hours numeric(10, 2) check (response_business_hours is null or response_business_hours >= 0),
  foreign key (item_id, quote_version) references public.item_quotes (item_id, version),
  check ((resolved_at is null) = (resolution is null))
);
create unique index item_update_requests_open_idx on public.item_update_requests (item_id) where resolved_at is null;
create index item_update_requests_item_idx on public.item_update_requests (item_id);

create or replace function public.item_update_requests_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'item_update_requests es inmutable: no se permite DELETE (trazabilidad ISO 9001)';
  end if;
  if old.resolved_at is not null then
    raise exception 'La solicitud de actualizacion ya fue resuelta y no se puede modificar';
  end if;
  if new.item_id <> old.item_id or new.quote_version <> old.quote_version or new.requested_by <> old.requested_by
     or new.requested_at <> old.requested_at or new.due_at <> old.due_at or new.nota is distinct from old.nota then
    raise exception 'Solo se puede registrar la resolucion de la solicitud';
  end if;
  return new;
end $$;
create trigger item_update_requests_guard before update or delete on public.item_update_requests
  for each row execute function public.item_update_requests_guard();
create trigger item_update_requests_audit after insert or update or delete on public.item_update_requests
  for each row execute function public.audit_row();

alter table public.item_update_requests enable row level security;
revoke all on public.item_update_requests from anon, authenticated;
grant select on public.item_update_requests to authenticated;
create policy update_requests_select on public.item_update_requests for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

-- ---------------------------------------------------------------------------
-- Guards reemplazados
-- ---------------------------------------------------------------------------
create or replace function public.item_costs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.pricing_config; f jsonb := new.factors_snapshot; p public.item_costs; v_ok_cfg boolean; v_ok_copy boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_buyer() then
    raise exception 'Solo un comprador activo puede registrar costos';
  end if;
  select * into c from public.pricing_config order by id desc limit 1;
  v_ok_cfg := (f ->> 'no_shipping_markup')::numeric is not distinct from c.no_shipping_markup
    and (f ->> 'p1')::numeric is not distinct from c.p1 and (f ->> 'p2')::numeric is not distinct from c.p2
    and (f ->> 'p3')::numeric is not distinct from c.p3 and (f ->> 'p4')::numeric is not distinct from c.p4
    and (f ->> 'p5')::numeric is not distinct from c.p5;
  -- "Confirmar sin cambios": una version nueva puede repetir exactamente los costos y factores de la anterior.
  if not v_ok_cfg and new.version > 1 then
    select * into p from public.item_costs where item_id = new.item_id and version = new.version - 1;
    v_ok_copy := found and p.costo = new.costo and p.envio is not distinct from new.envio
      and p.factors_snapshot = new.factors_snapshot;
  end if;
  if not (v_ok_cfg or v_ok_copy) then
    raise exception 'Los factores no coinciden con la configuracion vigente; recarga e intenta de nuevo';
  end if;
  new.base := case when coalesce(new.envio, 0) > 0 then new.costo + new.envio
                   else new.costo * (1 + (f ->> 'no_shipping_markup')::numeric) end;
  return new;
end $$;

create or replace function public.item_quotes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare k public.item_costs; i public.quote_items; v_max smallint; v_dias integer;
begin
  select * into i from public.quote_items where id = new.item_id;
  select coalesce(max(version), 0) into v_max from public.item_quotes where item_id = new.item_id;
  if new.version <> v_max + 1 then
    raise exception 'Version de cotizacion invalida (esperada %)', v_max + 1;
  end if;
  if new.version = 1 and i.estado not in ('pendiente', 'no_encontrada') then
    raise exception 'La partida ya esta cotizada';
  end if;
  -- Las versiones 2+ (revisiones) solo existen con una solicitud de actualizacion abierta.
  if new.version > 1 and (i.estado <> 'actualizacion_solicitada' or not exists (
       select 1 from public.item_update_requests where item_id = new.item_id and resolved_at is null)) then
    raise exception 'Una revision requiere una solicitud de actualizacion abierta';
  end if;
  select * into k from public.item_costs where item_id = new.item_id and version = new.version;
  if not found then raise exception 'Falta el costo de la partida'; end if;
  if new.price_1 <> round(k.base * (k.factors_snapshot ->> 'p1')::numeric, 2)
     or new.price_2 <> round(k.base * (k.factors_snapshot ->> 'p2')::numeric, 2)
     or new.price_3 <> round(k.base * (k.factors_snapshot ->> 'p3')::numeric, 2)
     or new.price_4 <> round(k.base * (k.factors_snapshot ->> 'p4')::numeric, 2)
     or new.price_5 <> round(k.base * (k.factors_snapshot ->> 'p5')::numeric, 2) then
    raise exception 'Los precios no coinciden con el tabulador';
  end if;
  -- Vigencia: siempre desde quoted_at, con los dias configurados (no confia en el cliente).
  select vigencia_dias into v_dias from public.app_settings;
  new.valid_until := new.quoted_at + make_interval(days => v_dias);
  return new;
end $$;

create or replace function public.quote_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_req public.request_status; v_max smallint; v_req_at timestamptz;
begin
  select estado into v_req from public.quote_requests
   where id = case when TG_OP = 'INSERT' then new.request_id else old.request_id end;

  if TG_OP = 'INSERT' then
    if v_req <> 'borrador' then
      raise exception 'No se pueden agregar partidas a una solicitud enviada';
    end if;
    if new.estado <> 'pendiente' then raise exception 'Estado inicial invalido'; end if;
    return new;
  end if;

  if new.request_id <> old.request_id then raise exception 'No se puede cambiar la solicitud'; end if;

  if v_req = 'borrador' then
    if new.estado <> 'pendiente' or new.not_found_note is not null
       or new.first_response_at is not null or new.response_business_hours is not null then
      raise exception 'Una partida en borrador no puede tener respuesta';
    end if;
    return new;
  end if;

  -- Solicitud enviada: el contenido capturado por el vendedor es fijo.
  if new.producto is distinct from old.producto or new.descripcion is distinct from old.descripcion
     or new.cantidad is distinct from old.cantidad or new.unidad is distinct from old.unidad
     or new.talla is distinct from old.talla or new.notas is distinct from old.notas
     or new.posicion <> old.posicion or new.folio is distinct from old.folio then
    raise exception 'El contenido de una partida enviada no se puede modificar';
  end if;

  if new.estado <> old.estado then
    if not (
      (old.estado = 'pendiente' and new.estado in ('cotizada', 'no_encontrada', 'esperando_aclaracion')) or
      (old.estado = 'no_encontrada' and new.estado in ('cotizada', 'esperando_aclaracion')) or
      (old.estado = 'cotizada' and new.estado in ('enviada_cliente', 'actualizacion_solicitada')) or
      (old.estado = 'enviada_cliente' and new.estado = 'actualizacion_solicitada') or
      (old.estado = 'actualizacion_solicitada' and new.estado in ('cotizada', 'esperando_aclaracion')) or
      (old.estado = 'esperando_aclaracion' and new.estado in ('pendiente', 'no_encontrada', 'actualizacion_solicitada'))
    ) then
      raise exception 'Transicion de estado invalida: % -> %', old.estado, new.estado;
    end if;

    select coalesce(max(version), 0) into v_max from public.item_quotes where item_id = new.id;
    if new.estado = 'cotizada' then
      if v_max = 0 then raise exception 'No hay cotizacion registrada para la partida'; end if;
      if old.estado = 'actualizacion_solicitada' then
        select requested_at into v_req_at from public.item_update_requests where item_id = new.id order by requested_at desc limit 1;
        if not exists (select 1 from public.item_quotes where item_id = new.id and quoted_at >= v_req_at and version > 1) then
          raise exception 'No hay una version nueva de la cotizacion';
        end if;
      end if;
    end if;
    if new.estado = 'enviada_cliente' and not exists (
         select 1 from public.item_dispatch where item_id = new.id and quote_version = v_max) then
      raise exception 'No hay registro de envio al cliente para la version vigente';
    end if;
    if new.estado = 'actualizacion_solicitada' and not exists (
         select 1 from public.item_update_requests where item_id = new.id and resolved_at is null) then
      raise exception 'No hay una solicitud de actualizacion abierta';
    end if;
  elsif old.estado in ('cotizada', 'enviada_cliente')
        and (new.not_found_note is distinct from old.not_found_note) then
    raise exception 'Una partida cotizada no se puede editar';
  end if;

  if new.first_response_at is distinct from old.first_response_at and old.first_response_at is not null then
    raise exception 'first_response_at no se puede cambiar';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- respond_item: quote | not_found | confirm | update_cost
-- ---------------------------------------------------------------------------
-- Claves de 'quote' y 'update_cost': costo, envio, moneda, factors{no_shipping_markup,p1..p5},
--   prices{p1..p5}, entrega{dias,tipo,fecha}, compra_min{cantidad,unidad,monto}, proveedor, nota, response_hours
--   (en 'update_cost' entrega, compra_min, moneda y nota son opcionales: se heredan de la version anterior)
-- Claves de 'confirm': nota (opcional), response_hours
-- Claves de 'not_found': nota, response_hours
create or replace function public.respond_item(p_item uuid, p_action text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.quote_items; r public.quote_requests; u public.item_update_requests;
  prevc public.item_costs; prevq public.item_quotes;
  v_prev public.item_status; v_version smallint;
  v_hours numeric := nullif(p_payload ->> 'response_hours', '')::numeric;
  v_nota text := nullif(trim(coalesce(p_payload ->> 'nota', '')), '');
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  v_prev := i.estado;

  if p_action = 'not_found' then
    if v_nota is null then
      raise exception 'La nota es obligatoria cuando no se encuentra el producto';
    end if;
    if i.estado not in ('pendiente', 'no_encontrada') then
      raise exception 'La partida ya esta cotizada y no se puede modificar';
    end if;
    update public.quote_items
       set estado = 'no_encontrada', not_found_note = v_nota,
           first_response_at = coalesce(first_response_at, now()),
           response_business_hours = coalesce(response_business_hours, v_hours)
     where id = p_item;
    if v_prev = 'pendiente' then
      perform public.notify_user(r.vendedor_id, 'respuesta_lista', 'Respuesta lista ' || i.folio,
        i.producto || ': no encontrada', '/vendedor/solicitudes/' || r.id, null);
    end if;
    return jsonb_build_object('estado', 'no_encontrada');

  elsif p_action = 'quote' then
    if i.estado not in ('pendiente', 'no_encontrada') then
      raise exception 'La partida ya esta cotizada y no se puede modificar';
    end if;
    v_version := 1;
    insert into public.item_costs (item_id, version, costo, envio, base, proveedor, factors_snapshot, created_by)
    values (p_item, v_version, (p_payload ->> 'costo')::numeric,
            nullif((p_payload ->> 'envio')::numeric, 0), 0,
            nullif(trim(coalesce(p_payload ->> 'proveedor', '')), ''),
            p_payload -> 'factors', auth.uid());
    insert into public.item_quotes (
      item_id, version, moneda, price_1, price_2, price_3, price_4, price_5,
      entrega_dias, entrega_tipo, entrega_fecha,
      compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by)
    values (p_item, v_version, (p_payload ->> 'moneda')::public.currency,
      (p_payload #>> '{prices,p1}')::numeric, (p_payload #>> '{prices,p2}')::numeric,
      (p_payload #>> '{prices,p3}')::numeric, (p_payload #>> '{prices,p4}')::numeric,
      (p_payload #>> '{prices,p5}')::numeric,
      (p_payload #>> '{entrega,dias}')::integer,
      (p_payload #>> '{entrega,tipo}')::public.delivery_kind,
      (p_payload #>> '{entrega,fecha}')::date,
      (p_payload #>> '{compra_min,cantidad}')::numeric,
      nullif(trim(coalesce(p_payload #>> '{compra_min,unidad}', '')), ''),
      (p_payload #>> '{compra_min,monto}')::numeric,
      v_nota, auth.uid());
    update public.quote_items
       set estado = 'cotizada',
           first_response_at = coalesce(first_response_at, now()),
           response_business_hours = coalesce(response_business_hours, v_hours)
     where id = p_item;
    perform public.notify_user(r.vendedor_id,
      case when v_prev = 'no_encontrada' then 'partida_recotizada' else 'respuesta_lista' end,
      case when v_prev = 'no_encontrada' then 'Partida recotizada ' else 'Respuesta lista ' end || i.folio,
      i.producto, '/vendedor/solicitudes/' || r.id, null);
    return jsonb_build_object('estado', 'cotizada', 'version', v_version);

  elsif p_action in ('confirm', 'update_cost') then
    if i.estado <> 'actualizacion_solicitada' then
      raise exception 'La partida no tiene una actualizacion solicitada';
    end if;
    select * into u from public.item_update_requests where item_id = p_item and resolved_at is null;
    if not found then raise exception 'No hay una solicitud de actualizacion abierta'; end if;
    select * into prevq from public.item_quotes where item_id = p_item order by version desc limit 1;
    select * into prevc from public.item_costs where item_id = p_item and version = prevq.version;
    v_version := prevq.version + 1;

    if p_action = 'confirm' then
      -- Mismos costos, factores, precios y condiciones; solo cambian la version y la vigencia.
      insert into public.item_costs (item_id, version, costo, envio, base, proveedor, factors_snapshot, created_by)
      values (p_item, v_version, prevc.costo, prevc.envio, 0, prevc.proveedor, prevc.factors_snapshot, auth.uid());
      insert into public.item_quotes (
        item_id, version, moneda, price_1, price_2, price_3, price_4, price_5, entrega_dias, entrega_tipo, entrega_fecha,
        compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by)
      values (p_item, v_version, prevq.moneda, prevq.price_1, prevq.price_2, prevq.price_3, prevq.price_4, prevq.price_5,
        prevq.entrega_dias, prevq.entrega_tipo, prevq.entrega_fecha,
        prevq.compra_min_cantidad, prevq.compra_min_unidad, prevq.compra_min_monto,
        coalesce(v_nota, prevq.nota), auth.uid());
    else
      insert into public.item_costs (item_id, version, costo, envio, base, proveedor, factors_snapshot, created_by)
      values (p_item, v_version, (p_payload ->> 'costo')::numeric, nullif((p_payload ->> 'envio')::numeric, 0), 0,
              coalesce(nullif(trim(coalesce(p_payload ->> 'proveedor', '')), ''), prevc.proveedor),
              p_payload -> 'factors', auth.uid());
      insert into public.item_quotes (
        item_id, version, moneda, price_1, price_2, price_3, price_4, price_5, entrega_dias, entrega_tipo, entrega_fecha,
        compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by)
      values (p_item, v_version, coalesce((p_payload ->> 'moneda')::public.currency, prevq.moneda),
        (p_payload #>> '{prices,p1}')::numeric, (p_payload #>> '{prices,p2}')::numeric,
        (p_payload #>> '{prices,p3}')::numeric, (p_payload #>> '{prices,p4}')::numeric,
        (p_payload #>> '{prices,p5}')::numeric,
        case when p_payload ? 'entrega' then (p_payload #>> '{entrega,dias}')::integer else prevq.entrega_dias end,
        case when p_payload ? 'entrega' then (p_payload #>> '{entrega,tipo}')::public.delivery_kind else prevq.entrega_tipo end,
        case when p_payload ? 'entrega' then (p_payload #>> '{entrega,fecha}')::date else prevq.entrega_fecha end,
        case when p_payload ? 'compra_min' then (p_payload #>> '{compra_min,cantidad}')::numeric else prevq.compra_min_cantidad end,
        case when p_payload ? 'compra_min' then nullif(trim(coalesce(p_payload #>> '{compra_min,unidad}', '')), '') else prevq.compra_min_unidad end,
        case when p_payload ? 'compra_min' then (p_payload #>> '{compra_min,monto}')::numeric else prevq.compra_min_monto end,
        coalesce(v_nota, prevq.nota), auth.uid());
    end if;

    update public.quote_items set estado = 'cotizada' where id = p_item;
    update public.item_update_requests
       set resolved_at = now(), resolved_by = auth.uid(), resolved_version = v_version,
           resolution = case when p_action = 'confirm' then 'sin_cambios' else 'actualizado' end,
           response_business_hours = v_hours
     where id = u.id;
    perform public.notify_user(r.vendedor_id, 'actualizacion_lista', 'Actualizacion lista ' || i.folio,
      i.producto || ': nueva version ' || v_version || '. Elige el precio y marca Enviado otra vez.',
      '/vendedor/solicitudes/' || r.id, null);
    return jsonb_build_object('estado', 'cotizada', 'version', v_version);
  end if;
  raise exception 'Accion invalida: %', p_action;
end $$;

-- ---------------------------------------------------------------------------
-- mark_item_dispatched: no se puede enviar una cotizacion con la vigencia vencida
-- ---------------------------------------------------------------------------
create or replace function public.mark_item_dispatched(p_item uuid, p_precio integer) returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; q public.item_quotes; v numeric;
begin
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if i.estado <> 'cotizada' then raise exception 'La partida no esta lista para enviarse'; end if;
  if p_precio is null or p_precio not between 1 and 5 then
    raise exception 'Debes seleccionar uno de los 5 precios';
  end if;
  select * into q from public.item_quotes where item_id = p_item order by version desc limit 1;
  if q.valid_until is not null and q.valid_until < now() then
    raise exception 'Vigencia vencida: solicita actualizacion';
  end if;
  v := case p_precio when 1 then q.price_1 when 2 then q.price_2 when 3 then q.price_3
                     when 4 then q.price_4 else q.price_5 end;
  insert into public.item_dispatch (item_id, quote_version, precio_elegido, valor, user_id)
  values (p_item, q.version, p_precio, v, auth.uid());
  update public.quote_items set estado = 'enviada_cliente' where id = p_item;
end $$;

-- Permisos de las funciones reemplazadas (se reaplican de forma explicita).
revoke all on function public.respond_item(uuid, text, jsonb) from public, anon;
grant execute on function public.respond_item(uuid, text, jsonb) to authenticated;
revoke all on function public.mark_item_dispatched(uuid, integer) from public, anon;
grant execute on function public.mark_item_dispatched(uuid, integer) to authenticated;
revoke all on function public.item_costs_guard() from public, anon, authenticated;
revoke all on function public.item_quotes_guard() from public, anon, authenticated;
revoke all on function public.quote_items_guard() from public, anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva; cada una debe dar lo indicado):
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.item_quotes'::regclass and tgname = 'item_quotes_locked';
--     -- tgenabled = 'O' (activo)
--   select count(*) as sin_vigencia from public.item_quotes where valid_until is null;     -- 0
--   select vigencia_dias from public.app_settings;                                          -- 15
--   select to_regclass('public.item_update_requests') is not null as tabla_creada;          -- true
--   select count(*) from public.audit_log where action = 'backfill_valid_until';            -- 1
-- -----------------------------------------------------------------------------
