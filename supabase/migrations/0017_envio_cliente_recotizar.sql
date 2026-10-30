-- =============================================================================
-- 0017_envio_cliente_recotizar.sql
-- Que hace (todo trazable para ISO 9001; nada se borra):
--   * EMISIONES: cada vez que el vendedor registra una cotizacion como enviada al cliente se guarda una
--     "emision" con su NUMERO propio y una copia fija de lo que vio el cliente (quote_issues), los precios
--     por partida (quote_issue_lines) y cada envio con medio y destinatario (quote_issue_sends).
--     Numero: folio de la solicitud, -R2/-R3 si el comprador actualizo costos, y -V2/-V3 por cada
--     recotizacion de la misma revision. Ej.: COT-2026-0040, COT-2026-0040-V2, COT-2026-0040-R2.
--   * RECOTIZAR: quote_renegotiations abre una recotizacion con motivo. Mientras esta abierta, el vendedor
--     puede elegir otro de los 5 precios y cambiar los datos del PDF; al registrar el envio nace un numero
--     nuevo y el anterior queda intacto. Cancelarla regresa los precios a los ya enviados.
--   * ENVIO AL CLIENTE: como lo ve el cliente (envio_presentacion): sin envio, incluido en el precio,
--     como cargo aparte (renglon en el PDF) o mixto (una parte incluida y otra aparte).
--   * CLIENTES: base general. Los vendedores dan de alta y completan clientes (nombre, RFC, direccion,
--     contacto); solo el comprador activa o desactiva. Para enviar una solicitud nueva el cliente debe
--     tener RFC, direccion y telefono o correo.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0001 a 0016.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Clientes: base general con datos completos
-- ---------------------------------------------------------------------------
create or replace function public.rfc_valido(p text) returns boolean
language sql immutable as $$
  select p ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$';
$$;

create or replace function public.customers_data_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nombre := trim(new.nombre);
  new.rfc := nullif(upper(regexp_replace(coalesce(new.rfc, ''), '[\s.-]', '', 'g')), '');
  new.razon_social := nullif(trim(coalesce(new.razon_social, '')), '');
  new.direccion := nullif(trim(coalesce(new.direccion, '')), '');
  new.contacto_nombre := nullif(trim(coalesce(new.contacto_nombre, '')), '');
  new.contacto_telefono := nullif(trim(coalesce(new.contacto_telefono, '')), '');
  new.contacto_correo := nullif(lower(trim(coalesce(new.contacto_correo, ''))), '');
  if new.rfc is not null and not public.rfc_valido(new.rfc) then
    raise exception 'RFC invalido: deben ser 12 o 13 caracteres (extranjero: XEXX010101000)';
  end if;
  if new.contacto_correo is not null and new.contacto_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo del cliente invalido';
  end if;
  if new.contacto_telefono is not null and length(regexp_replace(new.contacto_telefono, '\D', '', 'g')) < 7 then
    raise exception 'Telefono del cliente invalido';
  end if;
  if TG_OP = 'UPDATE' and new.activo is distinct from old.activo and not public.is_buyer() then
    raise exception 'Solo el comprador puede activar o desactivar clientes';
  end if;
  return new;
end $$;
create trigger customers_data_guard before insert or update on public.customers
  for each row execute function public.customers_data_guard();

grant insert (nombre, tipo, created_by, razon_social, rfc, direccion, contacto_nombre, contacto_correo, contacto_telefono)
  on public.customers to authenticated;
-- Los vendedores completan y corrigen datos (queda en la bitacora); activo solo lo cambia el comprador (trigger).
create policy customers_update_seller on public.customers for update to authenticated
  using (public.is_seller()) with check (public.is_seller());

create or replace function public.customer_is_complete(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.customers c
     where c.id = p_id
       and length(c.nombre) >= 2
       and c.rfc is not null and public.rfc_valido(c.rfc)
       and length(coalesce(c.direccion, '')) >= 5
       and (c.contacto_telefono is not null or c.contacto_correo is not null)
  );
$$;
grant execute on function public.customer_is_complete(uuid) to authenticated;

create or replace function public.quote_requests_customer_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and old.estado = 'borrador' and new.estado = 'enviada'
     and not public.customer_is_complete(new.customer_id) then
    raise exception 'Completa los datos del cliente (RFC, direccion y telefono o correo) antes de enviar la solicitud';
  end if;
  return new;
end $$;
create trigger quote_requests_customer_check before update on public.quote_requests
  for each row execute function public.quote_requests_customer_check();

-- ---------------------------------------------------------------------------
-- 2) Como ve el cliente el envio
-- ---------------------------------------------------------------------------
alter table public.quote_pdf_data
  add column envio_presentacion text check (envio_presentacion in ('sin_envio', 'incluido', 'aparte', 'mixto')),
  add column envio_aparte_monto numeric(14, 2) check (envio_aparte_monto is null or envio_aparte_monto > 0),
  add column envio_aparte_moneda public.currency;

-- ---------------------------------------------------------------------------
-- 3) Emisiones, envios y recotizaciones
-- ---------------------------------------------------------------------------
create table public.quote_renegotiations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id),
  motivo text not null check (length(trim(motivo)) between 3 and 500),
  abierta_por uuid not null references public.profiles (id),
  abierta_at timestamptz not null default now(),
  cerrada_at timestamptz,
  cancelada boolean not null default false,
  issue_id uuid
);
create unique index quote_renegotiations_open_idx on public.quote_renegotiations (request_id) where cerrada_at is null;

create table public.quote_issues (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id),
  revision smallint not null check (revision >= 1),
  secuencia smallint not null check (secuencia >= 1),
  numero text not null unique,
  snapshot jsonb not null,
  renegociacion_id uuid references public.quote_renegotiations (id),
  emitida_por uuid not null references public.profiles (id),
  emitida_at timestamptz not null default now(),
  unique (request_id, revision, secuencia)
);
create index quote_issues_request_idx on public.quote_issues (request_id, emitida_at desc);
alter table public.quote_renegotiations
  add constraint quote_renegotiations_issue_fk foreign key (issue_id) references public.quote_issues (id);

create table public.quote_issue_lines (
  issue_id uuid not null references public.quote_issues (id),
  item_id uuid not null references public.quote_items (id),
  quote_version smallint not null,
  precio_elegido smallint not null check (precio_elegido between 1 and 5),
  valor numeric(14, 2) not null,
  primary key (issue_id, item_id)
);

create table public.quote_issue_sends (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.quote_issues (id),
  medio text not null check (medio in ('correo', 'whatsapp', 'en_persona', 'telefono', 'otro')),
  destinatario text check (destinatario is null or length(destinatario) <= 200),
  nota text check (nota is null or length(nota) <= 500),
  enviado_por uuid not null references public.profiles (id),
  enviado_at timestamptz not null default now()
);
create index quote_issue_sends_issue_idx on public.quote_issue_sends (issue_id, enviado_at);

create trigger quote_issues_immutable before update or delete on public.quote_issues
  for each row execute function public.forbid_mutation();
create trigger quote_issue_lines_immutable before update or delete on public.quote_issue_lines
  for each row execute function public.forbid_mutation();
create trigger quote_issue_sends_immutable before update or delete on public.quote_issue_sends
  for each row execute function public.forbid_mutation();
create trigger quote_renegotiations_no_delete before delete on public.quote_renegotiations
  for each row execute function public.forbid_mutation();
create trigger quote_issues_audit after insert on public.quote_issues
  for each row execute function public.audit_row();
create trigger quote_issue_sends_audit after insert on public.quote_issue_sends
  for each row execute function public.audit_row();
create trigger quote_renegotiations_audit after insert or update on public.quote_renegotiations
  for each row execute function public.audit_row();

create or replace function public.issue_request_id(p_issue uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select request_id from public.quote_issues where id = p_issue;
$$;
grant execute on function public.issue_request_id(uuid) to authenticated;

alter table public.quote_issues enable row level security;
alter table public.quote_issue_lines enable row level security;
alter table public.quote_issue_sends enable row level security;
alter table public.quote_renegotiations enable row level security;
revoke all on public.quote_issues, public.quote_issue_lines, public.quote_issue_sends, public.quote_renegotiations from anon, authenticated;
grant select on public.quote_issues, public.quote_issue_lines, public.quote_issue_sends, public.quote_renegotiations to authenticated;
create policy issues_select on public.quote_issues for select to authenticated
  using (public.can_read_request(request_id));
create policy issue_lines_select on public.quote_issue_lines for select to authenticated
  using (public.can_read_request(public.issue_request_id(issue_id)));
create policy issue_sends_select on public.quote_issue_sends for select to authenticated
  using (public.can_read_request(public.issue_request_id(issue_id)));
create policy renegotiations_select on public.quote_renegotiations for select to authenticated
  using (public.can_read_request(request_id));

create or replace function public.open_renegotiation_id(p_request uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.quote_renegotiations where request_id = p_request and cerrada_at is null;
$$;

-- El envio al cliente solo cambia por una emision nueva (recotizacion); nunca se borra.
create or replace function public.item_dispatch_guard() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' or coalesce(current_setting('esc.reemision', true), '') <> 'on' then
    raise exception 'item_dispatch es inmutable: no se permite % (trazabilidad ISO 9001)', TG_OP using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger item_dispatch_locked on public.item_dispatch;
create trigger item_dispatch_locked before update or delete on public.item_dispatch
  for each row execute function public.item_dispatch_guard();

-- El precio elegido queda fijo al enviarse, salvo durante una recotizacion abierta.
create or replace function public.item_price_choice_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then raise exception 'item_price_choice es inmutable: no se permite DELETE'; end if;
  if exists (select 1 from public.item_dispatch where item_id = old.item_id and quote_version = old.quote_version)
     and public.open_renegotiation_id(public.item_request_id(old.item_id)) is null then
    raise exception 'El precio ya se envio al cliente y quedo fijo para esta version (usa Recotizar)';
  end if;
  return new;
end $$;

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
  if not (i.estado = 'cotizada'
          or (i.estado = 'enviada_cliente' and public.open_renegotiation_id(r.id) is not null)) then
    raise exception 'La partida no esta lista para elegir precio';
  end if;
  if p_precio is null or p_precio not between 1 and 5 then raise exception 'Debes seleccionar uno de los 5 precios'; end if;
  select * into q from public.item_quotes where item_id = p_item order by version desc limit 1;
  if q.valid_until is not null and q.valid_until < now() then
    raise exception 'Vigencia vencida: solicita actualizacion';
  end if;
  insert into public.item_price_choice (item_id, quote_version, precio, chosen_by)
  values (p_item, q.version, p_precio, auth.uid())
  on conflict (item_id, quote_version) do update set precio = excluded.precio, chosen_by = excluded.chosen_by, chosen_at = now();
end $$;

create or replace function public.open_renegotiation(p_request uuid, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; v_id uuid;
begin
  select * into r from public.quote_requests where id = p_request for update;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribe el motivo de la recotizacion'; end if;
  if public.open_renegotiation_id(p_request) is not null then raise exception 'Ya hay una recotizacion abierta'; end if;
  if not exists (select 1 from public.item_dispatch d join public.quote_items i on i.id = d.item_id where i.request_id = p_request) then
    raise exception 'Primero registra el envio de la cotizacion al cliente';
  end if;
  if exists (
    select 1 from public.quote_items i
      join lateral (select * from public.item_quotes q where q.item_id = i.id order by version desc limit 1) q on true
     where i.request_id = p_request and q.valid_until is not null and q.valid_until < now()
  ) then
    raise exception 'La vigencia vencio: solicita actualizacion de costos antes de recotizar';
  end if;
  insert into public.quote_renegotiations (request_id, motivo, abierta_por)
  values (p_request, trim(p_motivo), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_renegotiation(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; v_id uuid;
begin
  select * into r from public.quote_requests where id = p_request for update;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  v_id := public.open_renegotiation_id(p_request);
  if v_id is null then raise exception 'No hay recotizacion abierta'; end if;
  -- Regresa los precios a los ya enviados (mientras sigue abierta, el guard lo permite).
  update public.item_price_choice c
     set precio = d.precio_elegido, chosen_by = auth.uid(), chosen_at = now()
    from public.item_dispatch d, public.quote_items i
   where d.item_id = c.item_id and d.quote_version = c.quote_version
     and i.id = c.item_id and i.request_id = p_request and c.precio <> d.precio_elegido;
  update public.quote_renegotiations set cerrada_at = now(), cancelada = true where id = v_id;
end $$;

-- Registrar la cotizacion como enviada al cliente: crea la emision con numero, precios y copia fija.
create or replace function public.issue_quote(
  p_request uuid, p_medio text, p_destinatario text, p_nota text, p_snapshot jsonb
) returns table (issue_id uuid, numero text)
language plpgsql security definer set search_path = public as $$
declare
  r public.quote_requests; v_rev smallint; v_seq smallint; v_num text; v_reneg uuid; v_issue uuid;
  it record; v_pending integer := 0; v_changed integer := 0; v_lines integer := 0; v_has_issue boolean; v_valor numeric;
begin
  select * into r from public.quote_requests where id = p_request for update;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if p_medio is null or p_medio not in ('correo', 'whatsapp', 'en_persona', 'telefono', 'otro') then
    raise exception 'Elige por que medio se envio';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or jsonb_typeof(p_snapshot -> 'rows') is distinct from 'array' then
    raise exception 'La vista de la cotizacion no es valida';
  end if;

  select coalesce(max(q.version), 1) into v_rev
    from public.item_quotes q join public.quote_items i on i.id = q.item_id where i.request_id = p_request;
  v_reneg := public.open_renegotiation_id(p_request);
  select exists (select 1 from public.quote_issues x where x.request_id = p_request and x.revision = v_rev) into v_has_issue;

  for it in
    select i.id, i.folio, i.estado, q.version, q.valid_until, c.precio, d.precio_elegido as disp
      from public.quote_items i
      join lateral (select * from public.item_quotes q where q.item_id = i.id order by version desc limit 1) q on true
      left join public.item_price_choice c on c.item_id = i.id and c.quote_version = q.version
      left join public.item_dispatch d on d.item_id = i.id and d.quote_version = q.version
     where i.request_id = p_request
  loop
    if it.estado not in ('cotizada', 'enviada_cliente') then
      raise exception 'La partida % no esta lista para enviarse', it.folio;
    end if;
    if it.valid_until is not null and it.valid_until < now() then
      raise exception 'Vigencia vencida en la partida %: solicita actualizacion', it.folio;
    end if;
    if it.precio is null then raise exception 'Elige el precio de la partida %', it.folio; end if;
    if it.disp is null then v_pending := v_pending + 1;
    elsif it.disp <> it.precio then v_changed := v_changed + 1; end if;
    v_lines := v_lines + 1;
  end loop;
  if v_lines = 0 then raise exception 'Aun no hay partidas cotizadas'; end if;
  if v_changed > 0 and v_reneg is null then raise exception 'Para cambiar precios ya enviados usa Recotizar'; end if;
  if v_pending = 0 and v_reneg is null and v_has_issue then
    raise exception 'Esta cotizacion ya esta registrada como enviada. Usa "Registrar otro envio" o "Recotizar"';
  end if;

  select coalesce(max(x.secuencia), 0) + 1 into v_seq from public.quote_issues x where x.request_id = p_request and x.revision = v_rev;
  v_num := r.folio || case when v_rev > 1 then '-R' || v_rev else '' end || case when v_seq > 1 then '-V' || v_seq else '' end;

  insert into public.quote_issues (request_id, revision, secuencia, numero, snapshot, renegociacion_id, emitida_por)
  values (p_request, v_rev, v_seq, v_num, jsonb_set(p_snapshot, '{folio}', to_jsonb(v_num)), v_reneg, auth.uid())
  returning id into v_issue;

  perform set_config('esc.reemision', 'on', true);
  for it in
    select i.id, i.estado, q.version, q.price_1, q.price_2, q.price_3, q.price_4, q.price_5, c.precio, d.precio_elegido as disp
      from public.quote_items i
      join lateral (select * from public.item_quotes q where q.item_id = i.id order by version desc limit 1) q on true
      join public.item_price_choice c on c.item_id = i.id and c.quote_version = q.version
      left join public.item_dispatch d on d.item_id = i.id and d.quote_version = q.version
     where i.request_id = p_request
  loop
    v_valor := case it.precio when 1 then it.price_1 when 2 then it.price_2 when 3 then it.price_3
                              when 4 then it.price_4 else it.price_5 end;
    insert into public.quote_issue_lines (issue_id, item_id, quote_version, precio_elegido, valor)
    values (v_issue, it.id, it.version, it.precio, v_valor);
    if it.disp is null then
      insert into public.item_dispatch (item_id, quote_version, precio_elegido, valor, user_id)
      values (it.id, it.version, it.precio, v_valor, auth.uid());
      update public.quote_items set estado = 'enviada_cliente' where id = it.id and estado = 'cotizada';
    elsif it.disp <> it.precio then
      update public.item_dispatch set precio_elegido = it.precio, valor = v_valor, enviado_at = now(), user_id = auth.uid()
       where item_id = it.id and quote_version = it.version;
    end if;
  end loop;
  perform set_config('esc.reemision', 'off', true);

  if v_reneg is not null then
    update public.quote_renegotiations set cerrada_at = now(), issue_id = v_issue where id = v_reneg;
  end if;
  insert into public.quote_issue_sends (issue_id, medio, destinatario, nota, enviado_por)
  values (v_issue, p_medio, nullif(trim(coalesce(p_destinatario, '')), ''), nullif(trim(coalesce(p_nota, '')), ''), auth.uid());
  return query select v_issue, v_num;
end $$;

-- Otro envio del MISMO numero (por ejemplo, tambien por WhatsApp): no crea numero nuevo.
create or replace function public.register_issue_send(p_issue uuid, p_medio text, p_destinatario text, p_nota text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; v_id uuid;
begin
  select q.* into r from public.quote_requests q join public.quote_issues x on x.request_id = q.id where x.id = p_issue;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_medio is null or p_medio not in ('correo', 'whatsapp', 'en_persona', 'telefono', 'otro') then
    raise exception 'Elige por que medio se envio';
  end if;
  insert into public.quote_issue_sends (issue_id, medio, destinatario, nota, enviado_por)
  values (p_issue, p_medio, nullif(trim(coalesce(p_destinatario, '')), ''), nullif(trim(coalesce(p_nota, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Datos del PDF: ya enviada y sin recotizacion abierta = no se cambia (se usa Recotizar).
create or replace function public.pdf_data_locked(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with rev as (
    select coalesce(max(q.version), 1) as v
      from public.item_quotes q join public.quote_items i on i.id = q.item_id where i.request_id = p_request
  )
  select exists (select 1 from public.quote_issues x, rev where x.request_id = p_request and x.revision = rev.v)
     and public.open_renegotiation_id(p_request) is null
     and not exists (select 1 from public.quote_items i where i.request_id = p_request and i.estado = 'cotizada');
$$;

create or replace function public.save_pdf_envio_v2(
  p_request uuid, p_destino text, p_via text, p_condiciones text, p_atencion text,
  p_modo text, p_monto numeric, p_moneda public.currency, p_items jsonb,
  p_presentacion text, p_aparte_monto numeric, p_aparte_moneda public.currency
) returns smallint
language plpgsql security definer set search_path = public as $$
declare v_rev smallint;
begin
  if public.pdf_data_locked(p_request) then
    raise exception 'La cotizacion ya se envio al cliente: usa Recotizar para cambiarla';
  end if;
  if p_presentacion is null or p_presentacion not in ('sin_envio', 'incluido', 'aparte', 'mixto') then
    raise exception 'Elige como ve el cliente el envio';
  end if;
  if p_presentacion in ('sin_envio', 'aparte') and p_modo <> 'incluido' then
    raise exception 'Con esa opcion no se reparte envio en los precios';
  end if;
  if p_presentacion in ('incluido', 'mixto') and p_modo = 'incluido' then
    raise exception 'Captura el envio que va incluido en los precios';
  end if;
  if p_presentacion in ('aparte', 'mixto') and (p_aparte_monto is null or p_aparte_monto <= 0 or p_aparte_moneda is null) then
    raise exception 'Captura el monto y la moneda del envio aparte';
  end if;
  v_rev := public.save_pdf_envio(p_request, p_destino, p_via, p_condiciones, p_atencion, p_modo, p_monto, p_moneda, p_items);
  update public.quote_pdf_data
     set envio_presentacion = p_presentacion,
         envio_aparte_monto = case when p_presentacion in ('aparte', 'mixto') then round(p_aparte_monto, 2) end,
         envio_aparte_moneda = case when p_presentacion in ('aparte', 'mixto') then p_aparte_moneda end
   where request_id = p_request and revision = v_rev;
  return v_rev;
end $$;

-- Permisos
do $$
declare f text;
begin
  foreach f in array array[
    'set_item_price_choice(uuid,integer)',
    'open_renegotiation(uuid,text)',
    'cancel_renegotiation(uuid)',
    'issue_quote(uuid,text,text,text,jsonb)',
    'register_issue_send(uuid,text,text,text)',
    'save_pdf_envio_v2(uuid,text,text,text,text,text,numeric,public.currency,jsonb,text,numeric,public.currency)',
    'pdf_data_locked(uuid)',
    'open_renegotiation_id(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select to_regclass('public.quote_issues') is not null and to_regclass('public.quote_issue_lines') is not null
--      and to_regclass('public.quote_issue_sends') is not null and to_regclass('public.quote_renegotiations') is not null
--      as tablas_creadas;                                                                    -- true
--   select column_name from information_schema.columns
--    where table_name = 'quote_pdf_data' and column_name like 'envio_%' order by 1;           -- incluye envio_presentacion y envio_aparte_*
--   select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in
--    ('issue_quote', 'register_issue_send', 'open_renegotiation', 'cancel_renegotiation', 'save_pdf_envio_v2',
--     'customer_is_complete');                                                                -- 6 filas
--   select count(*) filter (where public.customer_is_complete(id)) as completos, count(*) as total from public.customers;
-- -----------------------------------------------------------------------------
