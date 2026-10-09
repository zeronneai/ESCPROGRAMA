-- Funciones de negocio (security definer). Cada una valida quien llama.

create or replace function public.notify_user(
  p_user uuid, p_tipo text, p_titulo text, p_cuerpo text, p_link text, p_ref uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  values (p_user, p_tipo, p_titulo, p_cuerpo, p_link, p_ref)
  on conflict do nothing;
end $$;
revoke all on function public.notify_user(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Usuarios (las llama el comprador-administrador desde el servidor)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_profile(
  p_id uuid, p_nombre text, p_correo text, p_rol public.user_role default 'vendedor'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  insert into public.profiles (id, nombre, correo, rol, must_change_password, created_by)
  values (p_id, trim(p_nombre), lower(trim(p_correo)), p_rol, true, auth.uid());
  perform public.write_audit('user_created', 'profiles', p_id::text, null,
    jsonb_build_object('nombre', trim(p_nombre), 'correo', lower(trim(p_correo)), 'rol', p_rol));
end $$;

create or replace function public.admin_update_user(p_id uuid, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if length(trim(p_nombre)) = 0 then raise exception 'El nombre es obligatorio'; end if;
  update public.profiles set nombre = trim(p_nombre) where id = p_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
end $$;

create or replace function public.admin_set_user_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_id = auth.uid() and not p_active then
    raise exception 'No puedes desactivar tu propio usuario';
  end if;
  update public.profiles set activo = p_active where id = p_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
  perform public.write_audit(case when p_active then 'user_reactivated' else 'user_deactivated' end,
    'profiles', p_id::text);
end $$;

create or replace function public.admin_flag_password_reset(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.profiles set must_change_password = true where id = p_id;
  if not found then raise exception 'Usuario no encontrado'; end if;
  perform public.write_audit('password_reset', 'profiles', p_id::text);
end $$;

create or replace function public.complete_password_change() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_enabled() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.profiles set must_change_password = false where id = auth.uid();
  perform public.write_audit('password_changed', 'profiles', auth.uid()::text);
end $$;

create or replace function public.touch_login() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_enabled() then raise exception 'Usuario inactivo' using errcode = '42501'; end if;
  update public.profiles set last_login_at = now() where id = auth.uid();
  perform public.write_audit('login', 'profiles', auth.uid()::text);
end $$;

-- Eventos de bitacora generados por la aplicacion (lista blanca).
-- Nunca recibe el contenido copiado, solo metadatos.
create or replace function public.log_event(
  p_action text, p_entity text, p_entity_id text, p_meta jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_action not in ('copy_price_table', 'logout') then
    raise exception 'Accion de bitacora no permitida';
  end if;
  perform public.write_audit(p_action, p_entity, p_entity_id, null, null, p_meta);
end $$;

-- ---------------------------------------------------------------------------
-- Respuesta del comprador (punto unico y extensible)
-- ---------------------------------------------------------------------------
-- respond_item(item, accion, payload jsonb)
--   accion 'quote'     -> registra una nueva VERSION de cotizacion (hoy solo v1).
--   accion 'not_found' -> marca/edita "No encontrada" (requiere nota).
-- El payload es jsonb para que campos nuevos (vigencia, motivo de revision...)
-- se agreguen sin cambiar la firma. Claves de 'quote':
--   costo, envio, moneda, factors{no_shipping_markup,p1..p5}, prices{p1..p5},
--   entrega{dias,tipo,fecha}, compra_min{cantidad,unidad,monto},
--   proveedor, nota, response_hours
-- Claves de 'not_found': nota, response_hours
-- Claves desconocidas se ignoran. Devuelve {estado, version}.
create or replace function public.respond_item(p_item uuid, p_action text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.quote_items; r public.quote_requests;
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
  end if;
  raise exception 'Accion invalida: %', p_action;
end $$;

-- ---------------------------------------------------------------------------
-- Envio al cliente (registro de control)
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
  -- Siempre sobre la version vigente (la mas reciente).
  select * into q from public.item_quotes where item_id = p_item order by version desc limit 1;
  v := case p_precio when 1 then q.price_1 when 2 then q.price_2 when 3 then q.price_3
                     when 4 then q.price_4 else q.price_5 end;
  insert into public.item_dispatch (item_id, quote_version, precio_elegido, valor, user_id)
  values (p_item, q.version, p_precio, v, auth.uid());
  update public.quote_items set estado = 'enviada_cliente' where id = p_item;
end $$;

-- ---------------------------------------------------------------------------
-- Guardar borrador completo (atomico). SECURITY INVOKER: aplican las politicas RLS,
-- asi que solo el vendedor dueno puede escribir y solo mientras sea borrador.
-- payload: {request_id, customer_id, notas, items:[{id, producto, descripcion,
--   cantidad, unidad, talla, notas, refs:[{id, tipo, url}]}]}  (el orden del arreglo es la posicion)
-- ---------------------------------------------------------------------------
create or replace function public.save_draft(p_payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_req uuid := (p_payload ->> 'request_id')::uuid;
  v_ids uuid[]; v_ref_ids uuid[]; it jsonb; v_pos integer := 0; v_item uuid;
begin
  insert into public.quote_requests (id, vendedor_id, customer_id, notas)
  values (v_req, auth.uid(), (p_payload ->> 'customer_id')::uuid,
          nullif(trim(coalesce(p_payload ->> 'notas', '')), ''))
  on conflict (id) do update set customer_id = excluded.customer_id, notas = excluded.notas;

  select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) e;

  delete from public.item_references
   where item_id in (select id from public.quote_items where request_id = v_req and id <> all (v_ids));
  delete from public.quote_items where request_id = v_req and id <> all (v_ids);

  for it in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    v_item := (it ->> 'id')::uuid;
    insert into public.quote_items (id, request_id, posicion, producto, descripcion, cantidad, unidad, talla, notas)
    values (v_item, v_req, v_pos, trim(coalesce(it ->> 'producto', '')),
            trim(coalesce(it ->> 'descripcion', '')),
            nullif(it ->> 'cantidad', '')::numeric, nullif(it ->> 'unidad', ''),
            nullif(trim(coalesce(it ->> 'talla', '')), ''),
            nullif(trim(coalesce(it ->> 'notas', '')), ''))
    on conflict (id) do update set
      posicion = excluded.posicion, producto = excluded.producto, descripcion = excluded.descripcion,
      cantidad = excluded.cantidad, unidad = excluded.unidad, talla = excluded.talla, notas = excluded.notas;

    select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_ref_ids
      from jsonb_array_elements(coalesce(it -> 'refs', '[]'::jsonb)) r;
    delete from public.item_references where item_id = v_item and id <> all (v_ref_ids);
    insert into public.item_references (id, item_id, tipo, url)
    select (r ->> 'id')::uuid, v_item, (r ->> 'tipo')::public.reference_kind, r ->> 'url'
      from jsonb_array_elements(coalesce(it -> 'refs', '[]'::jsonb)) r
    on conflict (id) do nothing;
  end loop;
  return v_req;
end $$;
