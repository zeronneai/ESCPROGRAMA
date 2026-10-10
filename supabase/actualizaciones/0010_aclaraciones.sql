-- =============================================================================
-- 0010_aclaraciones.sql
-- Que hace: mini chat por partida entre vendedor y comprador, con imagen opcional, y pausa del
--           reloj de 48 horas habiles mientras el comprador espera una aclaracion.
--   * item_messages: mensajes (inmutables).
--   * item_clarification_pauses: clarification_requested_at y resumed_at por pausa.
--   * request_clarification() (comprador): pasa la partida a "esperando_aclaracion".
--   * post_item_message() (vendedor o comprador): si es la respuesta del vendedor, reanuda el reloj.
--   * Bucket privado "aclaraciones" para las imagenes del chat, con sus politicas.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0007_vigencia_revisiones.sql (estados y guard de partidas) y 0005 (storage_request_id).
-- =============================================================================

begin;

create table public.item_clarification_pauses (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.quote_items (id),
  requested_by uuid not null references public.profiles (id),
  clarification_requested_at timestamptz not null default now(),
  resumed_at timestamptz,
  resumed_by uuid references public.profiles (id),
  estado_previo public.item_status not null,
  check (estado_previo in ('pendiente', 'no_encontrada', 'actualizacion_solicitada')),
  check (resumed_at is null or resumed_at >= clarification_requested_at)
);
create unique index item_clarification_open_idx on public.item_clarification_pauses (item_id) where resumed_at is null;
create index item_clarification_item_idx on public.item_clarification_pauses (item_id);

create or replace function public.item_clarification_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then raise exception 'item_clarification_pauses es inmutable: no se permite DELETE'; end if;
  if old.resumed_at is not null then raise exception 'La pausa ya fue cerrada'; end if;
  if new.item_id <> old.item_id or new.requested_by <> old.requested_by
     or new.clarification_requested_at <> old.clarification_requested_at or new.estado_previo <> old.estado_previo then
    raise exception 'Solo se puede registrar la reanudacion';
  end if;
  return new;
end $$;
create trigger item_clarification_guard before update or delete on public.item_clarification_pauses
  for each row execute function public.item_clarification_guard();
create trigger item_clarification_audit after insert or update or delete on public.item_clarification_pauses
  for each row execute function public.audit_row();

create table public.item_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.quote_items (id),
  author_id uuid not null references public.profiles (id),
  author_rol public.user_role not null,
  kind text not null default 'mensaje' check (kind in ('mensaje', 'pedir_aclaracion', 'respuesta')),
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  check (length(trim(coalesce(body, ''))) > 0 or image_path is not null)
);
create index item_messages_item_idx on public.item_messages (item_id, created_at);
create trigger item_messages_immutable before update or delete on public.item_messages
  for each row execute function public.forbid_mutation();
create trigger item_messages_audit after insert on public.item_messages
  for each row execute function public.audit_row();

-- La BD no deja pasar a/desde "esperando_aclaracion" sin la pausa correspondiente.
create or replace function public.quote_items_clarification_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'esperando_aclaracion' and not exists (
       select 1 from public.item_clarification_pauses where item_id = new.id and resumed_at is null) then
    raise exception 'No hay una aclaracion pendiente para la partida';
  end if;
  if old.estado = 'esperando_aclaracion' and new.estado <> 'esperando_aclaracion' and exists (
       select 1 from public.item_clarification_pauses where item_id = new.id and resumed_at is null) then
    raise exception 'La aclaracion sigue pendiente: el reloj no se ha reanudado';
  end if;
  return new;
end $$;
create trigger quote_items_clarification_guard before update of estado on public.quote_items
  for each row when (new.estado is distinct from old.estado)
  execute function public.quote_items_clarification_guard();

alter table public.item_clarification_pauses enable row level security;
alter table public.item_messages enable row level security;
revoke all on public.item_clarification_pauses, public.item_messages from anon, authenticated;
grant select on public.item_clarification_pauses, public.item_messages to authenticated;
create policy pauses_select on public.item_clarification_pauses for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));
create policy messages_select on public.item_messages for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

-- ---------------------------------------------------------------------------
-- Pedir aclaracion (comprador): pausa el reloj
-- ---------------------------------------------------------------------------
create or replace function public.request_clarification(p_item uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; v_prev public.item_status;
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'Escribe la pregunta para el vendedor'; end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if i.estado not in ('pendiente', 'no_encontrada', 'actualizacion_solicitada') then
    raise exception 'No se puede pedir aclaracion en el estado actual de la partida';
  end if;
  v_prev := i.estado;
  insert into public.item_clarification_pauses (item_id, requested_by, estado_previo) values (p_item, auth.uid(), v_prev);
  insert into public.item_messages (item_id, author_id, author_rol, kind, body)
  values (p_item, auth.uid(), 'comprador', 'pedir_aclaracion', trim(p_body));
  update public.quote_items set estado = 'esperando_aclaracion' where id = p_item;
  perform public.notify_user(r.vendedor_id, 'aclaracion_solicitada', 'Aclaracion solicitada ' || i.folio,
    i.producto || ': el comprador necesita una aclaracion para continuar.', '/vendedor/solicitudes/' || r.id, null);
end $$;

-- ---------------------------------------------------------------------------
-- Mensaje en la partida (vendedor dueno o comprador)
-- ---------------------------------------------------------------------------
create or replace function public.post_item_message(p_item uuid, p_body text, p_image_path text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; v_rol public.user_role; v_pause public.item_clarification_pauses; b record;
begin
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if public.is_buyer() then v_rol := 'comprador';
  elsif public.is_seller() and r.vendedor_id = auth.uid() then v_rol := 'vendedor';
  else raise exception 'No autorizado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 and p_image_path is null then
    raise exception 'Escribe un mensaje o agrega una imagen';
  end if;
  if p_image_path is not null and p_image_path not like r.id::text || '/' || p_item::text || '/%' then
    raise exception 'Ruta de imagen invalida';
  end if;

  if v_rol = 'vendedor' and i.estado = 'esperando_aclaracion' then
    -- La respuesta del vendedor reanuda el reloj.
    select * into v_pause from public.item_clarification_pauses where item_id = p_item and resumed_at is null;
    update public.item_clarification_pauses set resumed_at = now(), resumed_by = auth.uid() where id = v_pause.id;
    insert into public.item_messages (item_id, author_id, author_rol, kind, body, image_path)
    values (p_item, auth.uid(), v_rol, 'respuesta', nullif(trim(coalesce(p_body, '')), ''), p_image_path);
    update public.quote_items set estado = v_pause.estado_previo where id = p_item;
    for b in select id from public.profiles where rol = 'comprador' and activo loop
      perform public.notify_user(b.id, 'aclaracion_respondida', 'Aclaracion respondida ' || i.folio,
        i.producto || ': el vendedor respondio; el reloj se reanudo.', '/comprador/solicitudes/' || r.id, null);
    end loop;
  else
    insert into public.item_messages (item_id, author_id, author_rol, kind, body, image_path)
    values (p_item, auth.uid(), v_rol, 'mensaje', nullif(trim(coalesce(p_body, '')), ''), p_image_path);
    if v_rol = 'comprador' then
      perform public.notify_user(r.vendedor_id, 'mensaje_nuevo', 'Mensaje nuevo ' || i.folio, i.producto,
        '/vendedor/solicitudes/' || r.id, null);
    else
      for b in select id from public.profiles where rol = 'comprador' and activo loop
        perform public.notify_user(b.id, 'mensaje_nuevo', 'Mensaje nuevo ' || i.folio, i.producto,
          '/comprador/solicitudes/' || r.id, null);
      end loop;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Imagenes del chat (bucket privado). Ruta: {request_id}/{item_id}/{archivo}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aclaraciones', 'aclaraciones', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

create policy aclaraciones_select on storage.objects for select to authenticated
  using (bucket_id = 'aclaraciones' and public.can_read_request(public.storage_request_id(name)));
create policy aclaraciones_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'aclaraciones' and public.can_read_request(public.storage_request_id(name)));

-- Permisos
revoke all on function public.request_clarification(uuid, text) from public, anon;
grant execute on function public.request_clarification(uuid, text) to authenticated;
revoke all on function public.post_item_message(uuid, text, text) from public, anon;
grant execute on function public.post_item_message(uuid, text, text) to authenticated;
revoke all on function public.quote_items_clarification_guard() from public, anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select id, public from storage.buckets where id = 'aclaraciones';                 -- public = false
--   select proname from pg_proc where proname in ('request_clarification', 'post_item_message')
--    and pronamespace = 'public'::regnamespace;                                       -- 2 filas
--   select to_regclass('public.item_messages') is not null as tabla_creada;           -- true
-- -----------------------------------------------------------------------------
