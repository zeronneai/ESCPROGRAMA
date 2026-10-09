-- =============================================================================
-- 0011_pdf_y_cliente.sql
-- Que hace: datos para el PDF de cotizacion y simplificacion de clientes.
--   * quote_requests.atencion y destino_entrega (texto libre, opcionales); save_draft los guarda.
--   * company_profile: datos fijos de ESC y leyendas del pie (editables por el comprador).
--   * quote_pdf_data: condiciones, via de envio y cargo de envio al cliente, por solicitud y revision.
--   * item_price_choice: el precio elegido se guarda al elegirlo (editable hasta marcar "Enviado",
--     despues queda fijo por version); todo cambio queda en la bitacora.
--   * Reemplaza mark_item_dispatched (usa el precio guardado), save_draft y log_event (download_pdf).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0008_resultados.sql.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Atencion y destino de entrega por solicitud
-- ---------------------------------------------------------------------------
alter table public.quote_requests
  add column if not exists atencion text,
  add column if not exists destino_entrega text;
grant insert (atencion, destino_entrega) on public.quote_requests to authenticated;
grant update (atencion, destino_entrega) on public.quote_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Datos fijos de la empresa y leyendas (una sola fila)
-- ---------------------------------------------------------------------------
create table public.company_profile (
  id boolean primary key default true check (id),
  nombre_comercial text not null default 'ESC Representaciones',
  razon_social text not null default 'ESC REPRESENTACIONES S. DE R. L. MI.',
  telefono text not null default '(614) 424-6200',
  web text not null default 'www.elsauz.com',
  direccion text not null default 'H. COLEGIO MILITAR No.5910-C, COL. NOMBRE DE DIOS C.P.31105, CHIHUAHUA, MEXICO',
  rfc text not null default 'RFC ERE 060228 NLA',
  condiciones_default text not null default 'Credito',
  pie_lineas text[] not null default array['16% VAT will be added to the invoice', 'Prices subject to change'],
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.company_profile default values;
create trigger company_profile_audit after insert or update or delete on public.company_profile
  for each row execute function public.audit_row();
alter table public.company_profile enable row level security;
revoke all on public.company_profile from anon, authenticated;
grant select on public.company_profile to authenticated;
grant update (nombre_comercial, razon_social, telefono, web, direccion, rfc, condiciones_default, pie_lineas, updated_by, updated_at)
  on public.company_profile to authenticated;
create policy company_select on public.company_profile for select to authenticated using (public.is_active_user());
create policy company_update on public.company_profile for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- ---------------------------------------------------------------------------
-- Precio elegido (se guarda al elegirlo)
-- ---------------------------------------------------------------------------
create table public.item_price_choice (
  item_id uuid not null references public.quote_items (id),
  quote_version smallint not null,
  precio smallint not null check (precio between 1 and 5),
  chosen_by uuid not null references public.profiles (id),
  chosen_at timestamptz not null default now(),
  primary key (item_id, quote_version),
  foreign key (item_id, quote_version) references public.item_quotes (item_id, version)
);
create or replace function public.item_price_choice_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then raise exception 'item_price_choice es inmutable: no se permite DELETE'; end if;
  if exists (select 1 from public.item_dispatch where item_id = old.item_id and quote_version = old.quote_version) then
    raise exception 'El precio ya se envio al cliente y quedo fijo para esta version';
  end if;
  return new;
end $$;
create trigger item_price_choice_guard before update or delete on public.item_price_choice
  for each row execute function public.item_price_choice_guard();
create trigger item_price_choice_audit after insert or update on public.item_price_choice
  for each row execute function public.audit_row();
alter table public.item_price_choice enable row level security;
revoke all on public.item_price_choice from anon, authenticated;
grant select on public.item_price_choice to authenticated;
create policy price_choice_select on public.item_price_choice for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

create or replace function public.set_item_price_choice(p_item uuid, p_precio integer) returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; q public.item_quotes;
begin
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if i.estado <> 'cotizada' then raise exception 'La partida no esta lista para elegir precio'; end if;
  if p_precio is null or p_precio not between 1 and 5 then raise exception 'Debes seleccionar uno de los 5 precios'; end if;
  select * into q from public.item_quotes where item_id = p_item order by version desc limit 1;
  if q.valid_until is not null and q.valid_until < now() then
    raise exception 'Vigencia vencida: solicita actualizacion';
  end if;
  insert into public.item_price_choice (item_id, quote_version, precio, chosen_by)
  values (p_item, q.version, p_precio, auth.uid())
  on conflict (item_id, quote_version) do update set precio = excluded.precio, chosen_by = excluded.chosen_by, chosen_at = now();
end $$;

-- "Enviado al cliente" usa el precio guardado (p_precio opcional: si viene, se guarda primero).
create or replace function public.mark_item_dispatched(p_item uuid, p_precio integer) returns void
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; q public.item_quotes; v numeric; v_precio integer;
begin
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if i.estado <> 'cotizada' then raise exception 'La partida no esta lista para enviarse'; end if;
  select * into q from public.item_quotes where item_id = p_item order by version desc limit 1;
  if q.valid_until is not null and q.valid_until < now() then
    raise exception 'Vigencia vencida: solicita actualizacion';
  end if;
  if p_precio is not null then perform public.set_item_price_choice(p_item, p_precio); end if;
  select precio into v_precio from public.item_price_choice where item_id = p_item and quote_version = q.version;
  if v_precio is null then raise exception 'Debes seleccionar uno de los 5 precios'; end if;
  v := case v_precio when 1 then q.price_1 when 2 then q.price_2 when 3 then q.price_3
                     when 4 then q.price_4 else q.price_5 end;
  insert into public.item_dispatch (item_id, quote_version, precio_elegido, valor, user_id)
  values (p_item, q.version, v_precio, v, auth.uid());
  update public.quote_items set estado = 'enviada_cliente' where id = p_item;
end $$;

-- ---------------------------------------------------------------------------
-- Datos del PDF por solicitud y revision (cargo de envio AL CLIENTE; no es el costo del proveedor)
-- ---------------------------------------------------------------------------
create table public.quote_pdf_data (
  request_id uuid not null references public.quote_requests (id),
  revision smallint not null check (revision >= 1),
  destino_entrega text,
  via_envio text,
  condiciones text not null default 'Credito',
  atencion text,
  envio_modo text not null default 'incluido' check (envio_modo in ('incluido', 'aparte')),
  envio_monto numeric(14, 2),
  envio_moneda public.currency,
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (request_id, revision),
  check (envio_modo = 'incluido' or (envio_monto is not null and envio_monto > 0 and envio_moneda is not null))
);
create trigger quote_pdf_data_audit after insert or update on public.quote_pdf_data
  for each row execute function public.audit_row();
create trigger quote_pdf_data_no_delete before delete on public.quote_pdf_data
  for each row execute function public.forbid_mutation();
alter table public.quote_pdf_data enable row level security;
revoke all on public.quote_pdf_data from anon, authenticated;
grant select on public.quote_pdf_data to authenticated;
create policy pdf_data_select on public.quote_pdf_data for select to authenticated
  using (public.can_read_request(request_id));

create or replace function public.save_pdf_data(
  p_request uuid, p_destino text, p_via text, p_condiciones text, p_atencion text,
  p_modo text, p_monto numeric, p_moneda public.currency
) returns smallint
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; v_rev smallint;
begin
  select * into r from public.quote_requests where id = p_request;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if p_modo not in ('incluido', 'aparte') then raise exception 'Modo de envio invalido'; end if;
  if p_modo = 'aparte' and (p_monto is null or p_monto <= 0 or p_moneda is null) then
    raise exception 'Captura el monto y la moneda del envio';
  end if;
  select coalesce(max(q.version), 1) into v_rev
    from public.item_quotes q join public.quote_items i on i.id = q.item_id where i.request_id = p_request;
  insert into public.quote_pdf_data (request_id, revision, destino_entrega, via_envio, condiciones, atencion,
                                     envio_modo, envio_monto, envio_moneda, updated_by)
  values (p_request, v_rev, nullif(trim(coalesce(p_destino, '')), ''), nullif(trim(coalesce(p_via, '')), ''),
          coalesce(nullif(trim(coalesce(p_condiciones, '')), ''), 'Credito'), nullif(trim(coalesce(p_atencion, '')), ''),
          p_modo, case when p_modo = 'aparte' then p_monto end, case when p_modo = 'aparte' then p_moneda end, auth.uid())
  on conflict (request_id, revision) do update set
    destino_entrega = excluded.destino_entrega, via_envio = excluded.via_envio, condiciones = excluded.condiciones,
    atencion = excluded.atencion, envio_modo = excluded.envio_modo, envio_monto = excluded.envio_monto,
    envio_moneda = excluded.envio_moneda, updated_by = excluded.updated_by, updated_at = now();
  return v_rev;
end $$;

-- ---------------------------------------------------------------------------
-- save_draft: ahora guarda atencion y destino_entrega (misma firma; SECURITY INVOKER)
-- ---------------------------------------------------------------------------
create or replace function public.save_draft(p_payload jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_req uuid := (p_payload ->> 'request_id')::uuid;
  v_ids uuid[]; v_ref_ids uuid[]; it jsonb; v_pos integer := 0; v_item uuid;
begin
  insert into public.quote_requests (id, vendedor_id, customer_id, notas, atencion, destino_entrega)
  values (v_req, auth.uid(), (p_payload ->> 'customer_id')::uuid,
          nullif(trim(coalesce(p_payload ->> 'notas', '')), ''),
          nullif(trim(coalesce(p_payload ->> 'atencion', '')), ''),
          nullif(trim(coalesce(p_payload ->> 'destino_entrega', '')), ''))
  on conflict (id) do update set customer_id = excluded.customer_id, notas = excluded.notas,
    atencion = excluded.atencion, destino_entrega = excluded.destino_entrega;

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

-- ---------------------------------------------------------------------------
-- log_event: agrega download_pdf a la lista permitida
-- ---------------------------------------------------------------------------
create or replace function public.log_event(
  p_action text, p_entity text, p_entity_id text, p_meta jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_action not in ('copy_price_table', 'logout', 'download_pdf') then
    raise exception 'Accion de bitacora no permitida';
  end if;
  perform public.write_audit(p_action, p_entity, p_entity_id, null, null, p_meta);
end $$;

-- Permisos (se reaplican de forma explicita en las funciones reemplazadas)
revoke all on function public.set_item_price_choice(uuid, integer) from public, anon;
grant execute on function public.set_item_price_choice(uuid, integer) to authenticated;
revoke all on function public.save_pdf_data(uuid, text, text, text, text, text, numeric, public.currency) from public, anon;
grant execute on function public.save_pdf_data(uuid, text, text, text, text, text, numeric, public.currency) to authenticated;
revoke all on function public.mark_item_dispatched(uuid, integer) from public, anon;
grant execute on function public.mark_item_dispatched(uuid, integer) to authenticated;
revoke all on function public.save_draft(jsonb) from public, anon;
grant execute on function public.save_draft(jsonb) to authenticated;
revoke all on function public.log_event(text, text, text, jsonb) from public, anon;
grant execute on function public.log_event(text, text, text, jsonb) to authenticated;
revoke all on function public.item_price_choice_guard() from public, anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select razon_social, telefono, web, rfc from public.company_profile;               -- 1 fila con los datos de ESC
--   select column_name from information_schema.columns
--    where table_name = 'quote_requests' and column_name in ('atencion', 'destino_entrega');   -- 2 filas
--   select proname from pg_proc where proname in ('set_item_price_choice', 'save_pdf_data')
--    and pronamespace = 'public'::regnamespace;                                          -- 2 filas
-- -----------------------------------------------------------------------------
