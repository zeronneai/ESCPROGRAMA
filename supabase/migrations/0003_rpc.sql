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
-- Respuesta del comprador
-- ---------------------------------------------------------------------------
create or replace function public.respond_item_quoted(
  p_item uuid,
  p_costo numeric, p_envio numeric,
  p_moneda public.currency,
  p_factors jsonb,
  p_price_1 numeric, p_price_2 numeric, p_price_3 numeric, p_price_4 numeric, p_price_5 numeric,
  p_entrega_dias integer, p_entrega_tipo public.delivery_kind, p_entrega_fecha date,
  p_min_cantidad numeric, p_min_unidad text, p_min_monto numeric,
  p_proveedor text, p_nota text,
  p_response_hours numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; v_prev public.item_status;
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if i.estado not in ('pendiente', 'no_encontrada') then
    raise exception 'La partida ya esta cotizada y no se puede modificar';
  end if;
  v_prev := i.estado;

  insert into public.item_costs (item_id, costo, envio, base, proveedor, factors_snapshot, created_by)
  values (p_item, p_costo, nullif(p_envio, 0), 0, nullif(trim(coalesce(p_proveedor, '')), ''),
          p_factors, auth.uid());

  insert into public.item_quotes (
    item_id, moneda, price_1, price_2, price_3, price_4, price_5,
    entrega_dias, entrega_tipo, entrega_fecha,
    compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by)
  values (p_item, p_moneda, p_price_1, p_price_2, p_price_3, p_price_4, p_price_5,
    p_entrega_dias, p_entrega_tipo, p_entrega_fecha,
    p_min_cantidad, nullif(trim(coalesce(p_min_unidad, '')), ''), p_min_monto,
    nullif(trim(coalesce(p_nota, '')), ''), auth.uid());

  update public.quote_items
     set estado = 'cotizada',
         first_response_at = coalesce(first_response_at, now()),
         response_business_hours = coalesce(response_business_hours, p_response_hours)
   where id = p_item;

  perform public.notify_user(r.vendedor_id,
    case when v_prev = 'no_encontrada' then 'partida_recotizada' else 'respuesta_lista' end,
    case when v_prev = 'no_encontrada' then 'Partida recotizada ' else 'Respuesta lista ' end || i.folio,
    i.producto, '/vendedor/solicitudes/' || r.id, null);
end $$;

create or replace function public.respond_item_not_found(
  p_item uuid, p_nota text, p_response_hours numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests;
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_nota, ''))) = 0 then
    raise exception 'La nota es obligatoria cuando no se encuentra el producto';
  end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if i.estado not in ('pendiente', 'no_encontrada') then
    raise exception 'La partida ya esta cotizada y no se puede modificar';
  end if;

  update public.quote_items
     set estado = 'no_encontrada',
         not_found_note = trim(p_nota),
         first_response_at = coalesce(first_response_at, now()),
         response_business_hours = coalesce(response_business_hours, p_response_hours)
   where id = p_item;

  if i.estado = 'pendiente' then
    perform public.notify_user(r.vendedor_id, 'respuesta_lista', 'Respuesta lista ' || i.folio,
      i.producto || ': no encontrada', '/vendedor/solicitudes/' || r.id, null);
  end if;
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
  select * into q from public.item_quotes where item_id = p_item;
  v := case p_precio when 1 then q.price_1 when 2 then q.price_2 when 3 then q.price_3
                     when 4 then q.price_4 else q.price_5 end;
  insert into public.item_dispatch (item_id, precio_elegido, valor, user_id)
  values (p_item, p_precio, v, auth.uid());
  update public.quote_items set estado = 'enviada_cliente' where id = p_item;
end $$;
