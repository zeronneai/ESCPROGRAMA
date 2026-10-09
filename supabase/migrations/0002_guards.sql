-- Triggers de integridad: bitacora, bloqueos, maquina de estados, validaciones.

-- ---------------------------------------------------------------------------
-- Bitacora
-- ---------------------------------------------------------------------------
-- Escritura interna. No se concede EXECUTE a roles de la API.
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id text,
  p_old jsonb default null, p_new jsonb default null, p_meta jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, action, entity, entity_id, old_value, new_value, meta)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_old, p_new, p_meta);
end $$;
revoke all on function public.write_audit(text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Trigger generico: guarda solo las columnas que cambiaron.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_id text;
  v_diff_old jsonb; v_diff_new jsonb;
  v_ignore text[] := array['updated_at', 'last_login_at'];
begin
  if TG_OP in ('UPDATE', 'DELETE') then v_old := to_jsonb(OLD); end if;
  if TG_OP in ('INSERT', 'UPDATE') then v_new := to_jsonb(NEW); end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'item_id', v_old ->> 'item_id',
                   v_new ->> 'fecha', v_old ->> 'fecha');
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, o.value), '{}'::jsonb),
           coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      into v_diff_old, v_diff_new
      from jsonb_each(v_new) n
      left join jsonb_each(v_old) o on o.key = n.key
     where n.value is distinct from o.value and n.key <> all (v_ignore);
    if v_diff_new = '{}'::jsonb then return null; end if;
    v_old := v_diff_old; v_new := v_diff_new;
  end if;
  insert into public.audit_log (user_id, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_id, v_old, v_new);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','customers','quote_requests','quote_items','item_references',
    'item_costs','item_quotes','item_dispatch','pricing_config','app_settings','holidays']
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Tablas inmutables / sin borrado
-- ---------------------------------------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% es inmutable: no se permite % (trazabilidad ISO 9001)', TG_TABLE_NAME, TG_OP
    using errcode = 'P0001';
end $$;

-- Solo insercion: bitacora, configuracion de tabulador y registros de cotizacion.
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.forbid_mutation();
create trigger pricing_config_immutable before update or delete on public.pricing_config
  for each row execute function public.forbid_mutation();
-- Una partida Cotizada queda bloqueada para siempre (aplica tambien al administrador).
create trigger item_costs_locked before update or delete on public.item_costs
  for each row execute function public.forbid_mutation();
create trigger item_quotes_locked before update or delete on public.item_quotes
  for each row execute function public.forbid_mutation();
create trigger item_dispatch_locked before update or delete on public.item_dispatch
  for each row execute function public.forbid_mutation();

-- Nunca se borra: se archiva o se desactiva.
create trigger profiles_no_delete before delete on public.profiles
  for each row execute function public.forbid_mutation();
create trigger customers_no_delete before delete on public.customers
  for each row execute function public.forbid_mutation();
create trigger quote_requests_no_delete before delete on public.quote_requests
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Perfiles: nunca dejar el sistema sin un comprador activo
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  if old.rol = 'comprador' and old.activo
     and (new.activo = false or new.rol <> 'comprador')
     and not exists (select 1 from public.profiles
                     where rol = 'comprador' and activo and id <> old.id) then
    raise exception 'Debe existir al menos un comprador activo';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- Solicitudes
-- ---------------------------------------------------------------------------
create or replace function public.quote_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tz text; v_sla integer; v_year text; v_n integer;
  r record; v_pos integer := 0;
begin
  if TG_OP = 'UPDATE' then
    if old.estado = 'enviada' then
      if new.estado <> old.estado or new.vendedor_id <> old.vendedor_id
         or new.customer_id <> old.customer_id or new.folio is distinct from old.folio
         or new.submitted_at is distinct from old.submitted_at
         or new.due_at is distinct from old.due_at
         or new.notas is distinct from old.notas then
        raise exception 'Una solicitud enviada no se puede modificar';
      end if;
      return new;
    end if;
    if new.vendedor_id <> old.vendedor_id then
      raise exception 'No se puede cambiar el vendedor';
    end if;
  end if;

  -- borrador -> enviada: validar todo y asignar folios
  if new.estado = 'enviada' then
    select timezone, sla_business_hours into v_tz, v_sla from public.app_settings;
    if not exists (select 1 from public.customers where id = new.customer_id and activo) then
      raise exception 'Cliente invalido o inactivo';
    end if;
    if not exists (select 1 from public.quote_items where request_id = new.id) then
      raise exception 'La solicitud necesita al menos una partida';
    end if;
    for r in select * from public.quote_items where request_id = new.id order by posicion, created_at loop
      if length(trim(r.producto)) = 0 then
        raise exception 'Falta el nombre del producto en una partida';
      end if;
      if length(trim(r.descripcion)) < 10 then
        raise exception 'La descripcion de "%" debe tener al menos 10 caracteres', r.producto;
      end if;
      if r.cantidad is null and (r.talla is null or length(trim(r.talla)) = 0) then
        raise exception 'Falta cantidad o talla en "%"', r.producto;
      end if;
      if not exists (select 1 from public.item_references where item_id = r.id) then
        raise exception 'Falta al menos una referencia (imagen o link) en "%"', r.producto;
      end if;
    end loop;

    new.submitted_at := now();
    if new.due_at is null
       or new.due_at < now() + make_interval(hours => v_sla) - interval '5 minutes'
       or new.due_at > now() + make_interval(hours => v_sla) + interval '30 days' then
      raise exception 'Fecha de vencimiento fuera del rango permitido';
    end if;

    v_year := to_char(now() at time zone v_tz, 'YYYY');
    v_n := public.next_folio('COT-' || v_year);
    new.folio := 'COT-' || v_year || '-' || lpad(v_n::text, 4, '0');
    for r in select id from public.quote_items where request_id = new.id order by posicion, created_at loop
      v_pos := v_pos + 1;
      update public.quote_items
         set folio = new.folio || '-' || lpad(v_pos::text, 2, '0'), posicion = v_pos
       where id = r.id;
    end loop;
  end if;
  return new;
end $$;
create trigger quote_requests_guard before insert or update on public.quote_requests
  for each row execute function public.quote_requests_guard();

create or replace function public.quote_requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if old.estado = 'borrador' and new.estado = 'enviada' then
    for b in select id from public.profiles where rol = 'comprador' and activo loop
      insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
      values (b.id, 'nueva_solicitud', 'Nueva solicitud ' || new.folio,
              'Tienes una solicitud pendiente por responder.',
              '/comprador/solicitudes/' || new.id, new.id);
    end loop;
  end if;
  return null;
end $$;
create trigger quote_requests_notify after update on public.quote_requests
  for each row execute function public.quote_requests_notify();

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------
create or replace function public.quote_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_req public.request_status;
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
      (old.estado = 'pendiente' and new.estado in ('cotizada', 'no_encontrada')) or
      (old.estado = 'no_encontrada' and new.estado = 'cotizada') or
      (old.estado = 'cotizada' and new.estado = 'enviada_cliente')
    ) then
      raise exception 'Transicion de estado invalida: % -> %', old.estado, new.estado;
    end if;
    if new.estado = 'cotizada' and not exists (select 1 from public.item_quotes where item_id = new.id) then
      raise exception 'No hay cotizacion registrada para la partida';
    end if;
    if new.estado = 'enviada_cliente' and not exists (select 1 from public.item_dispatch where item_id = new.id) then
      raise exception 'No hay registro de envio al cliente';
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
create trigger quote_items_guard before insert or update on public.quote_items
  for each row execute function public.quote_items_guard();

-- Solo se puede borrar una partida mientras la solicitud sea borrador.
create or replace function public.quote_items_delete_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.quote_requests where id = old.request_id and estado <> 'borrador') then
    raise exception 'No se pueden borrar partidas de una solicitud enviada';
  end if;
  return old;
end $$;
create trigger quote_items_delete_guard before delete on public.quote_items
  for each row execute function public.quote_items_delete_guard();

-- ---------------------------------------------------------------------------
-- Referencias
-- ---------------------------------------------------------------------------
create or replace function public.item_references_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item uuid := case when TG_OP = 'DELETE' then old.item_id else new.item_id end;
begin
  if TG_OP = 'UPDATE' then raise exception 'Las referencias no se editan'; end if;
  if exists (
    select 1 from public.quote_items i join public.quote_requests r on r.id = i.request_id
     where i.id = v_item and r.estado <> 'borrador'
  ) then
    raise exception 'Las referencias de una solicitud enviada no se pueden modificar';
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end $$;
create trigger item_references_guard before insert or update or delete on public.item_references
  for each row execute function public.item_references_guard();

-- ---------------------------------------------------------------------------
-- Costos y precios (privacidad + integridad del tabulador)
-- ---------------------------------------------------------------------------
create or replace function public.item_costs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.pricing_config; f jsonb := new.factors_snapshot;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_buyer() then
    raise exception 'Solo un comprador activo puede registrar costos';
  end if;
  select * into c from public.pricing_config order by id desc limit 1;
  if (f ->> 'no_shipping_markup')::numeric is distinct from c.no_shipping_markup
     or (f ->> 'p1')::numeric is distinct from c.p1 or (f ->> 'p2')::numeric is distinct from c.p2
     or (f ->> 'p3')::numeric is distinct from c.p3 or (f ->> 'p4')::numeric is distinct from c.p4
     or (f ->> 'p5')::numeric is distinct from c.p5 then
    raise exception 'Los factores no coinciden con la configuracion vigente; recarga e intenta de nuevo';
  end if;
  new.base := case when coalesce(new.envio, 0) > 0 then new.costo + new.envio
                   else new.costo * (1 + c.no_shipping_markup) end;
  return new;
end $$;
create trigger item_costs_guard before insert on public.item_costs
  for each row execute function public.item_costs_guard();

create or replace function public.item_quotes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare k public.item_costs; i public.quote_items; v_max smallint;
begin
  select * into i from public.quote_items where id = new.item_id;
  select coalesce(max(version), 0) into v_max from public.item_quotes where item_id = new.item_id;
  if new.version <> v_max + 1 then
    raise exception 'Version de cotizacion invalida (esperada %)', v_max + 1;
  end if;
  if new.version = 1 and i.estado not in ('pendiente', 'no_encontrada') then
    raise exception 'La partida ya esta cotizada';
  end if;
  -- Las versiones 2+ (revisiones) solo existen sobre partidas ya cotizadas.
  if new.version > 1 and i.estado not in ('cotizada', 'enviada_cliente') then
    raise exception 'Una revision requiere una partida cotizada';
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
  return new;
end $$;
create trigger item_quotes_guard before insert on public.item_quotes
  for each row execute function public.item_quotes_guard();
