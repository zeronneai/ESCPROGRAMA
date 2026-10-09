-- =============================================================================
-- ESC Portal de Cotizaciones: instalacion completa de la base de datos
-- =============================================================================
-- COMO USAR (una sola vez, en un proyecto de Supabase NUEVO):
--   1. Supabase > SQL Editor > New query.
--   2. Pega TODO este archivo y presiona Run.
--   3. Debe terminar con "Success. No rows returned".
-- No lo ejecutes dos veces: si falla a la mitad, borra los objetos creados o usa
-- un proyecto nuevo. Este archivo se genera de supabase/migrations/*.sql
-- (bash scripts/build-install-sql.sh); no lo edites a mano.
-- Despues: crea tu usuario en Authentication > Users > Add user y corre
-- supabase/primer-comprador.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0001_core.sql
-- -----------------------------------------------------------------------------

-- ESC Portal de Cotizaciones: esquema base.
-- Convenciones: nada se borra de verdad (borrado logico o triggers que lo impiden).

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('vendedor', 'comprador');
create type public.customer_kind as enum ('cliente', 'prospecto');
create type public.request_status as enum ('borrador', 'enviada');
-- "Vencida" no es un estado guardado: se calcula al consultar a partir de due_at.
create type public.item_status as enum ('pendiente', 'cotizada', 'no_encontrada', 'enviada_cliente');
create type public.reference_kind as enum ('imagen', 'link');
create type public.currency as enum ('MXN', 'USD');
create type public.delivery_kind as enum ('habiles', 'naturales');

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  nombre text not null check (length(trim(nombre)) > 0),
  correo text not null,
  rol public.user_role not null default 'vendedor',
  activo boolean not null default true,
  must_change_password boolean not null default true,
  last_login_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_correo_key on public.profiles (lower(correo));
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Helpers de autorizacion (security definer para evitar recursion de RLS).
-- is_enabled: sesion de un usuario activo (aunque deba cambiar su contrasena).
-- is_active_user / is_buyer / is_seller: ademas ya cambio la contrasena temporal,
-- asi que con must_change_password = true la API de datos queda bloqueada en la BD.
create or replace function public.is_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo);
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and not must_change_password
  );
$$;

create or replace function public.is_buyer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and not must_change_password and rol = 'comprador'
  );
$$;

create or replace function public.is_seller() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and not must_change_password and rol = 'vendedor'
  );
$$;

-- ---------------------------------------------------------------------------
-- Configuracion
-- ---------------------------------------------------------------------------
-- Una sola fila. Zona horaria y plazos.
create table public.app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'America/Chihuahua',
  sla_business_hours integer not null default 48 check (sla_business_hours > 0),
  warn_business_hours integer not null default 12 check (warn_business_hours > 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;

-- Historial de factores del tabulador (solo insercion). La vigente es la ultima.
create table public.pricing_config (
  id bigint generated always as identity primary key,
  no_shipping_markup numeric(8, 4) not null default 0.04 check (no_shipping_markup >= 0),
  p5 numeric(8, 4) not null default 1.17 check (p5 > 0),
  p4 numeric(8, 4) not null default 1.26 check (p4 > 0),
  p3 numeric(8, 4) not null default 1.35 check (p3 > 0),
  p2 numeric(8, 4) not null default 1.43 check (p2 > 0),
  p1 numeric(8, 4) not null default 1.54 check (p1 > 0),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
insert into public.pricing_config default values;

create table public.holidays (
  fecha date primary key,
  descripcion text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  tipo public.customer_kind not null default 'prospecto',
  activo boolean not null default true,
  -- Preparado para datos completos del cliente (PDF futuro). No se capturan aun.
  razon_social text,
  rfc text,
  direccion text,
  contacto_nombre text,
  contacto_correo text,
  contacto_telefono text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_nombre_key on public.customers (lower(nombre));
create trigger customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Folios consecutivos
-- ---------------------------------------------------------------------------
create table public.folio_counters (
  scope text primary key,
  last_value integer not null default 0
);

create or replace function public.next_folio(p_scope text) returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.folio_counters as c (scope, last_value) values (p_scope, 1)
  on conflict (scope) do update set last_value = c.last_value + 1
  returning last_value into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Solicitudes y partidas
-- ---------------------------------------------------------------------------
create table public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  folio text unique,                         -- se asigna al enviar
  vendedor_id uuid not null references public.profiles (id),
  customer_id uuid not null references public.customers (id),
  estado public.request_status not null default 'borrador',
  notas text,
  submitted_at timestamptz,
  due_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((estado = 'borrador') = (submitted_at is null)),
  check ((estado = 'borrador') = (due_at is null))
);
create index quote_requests_vendedor_idx on public.quote_requests (vendedor_id, estado);
create index quote_requests_due_idx on public.quote_requests (due_at) where estado = 'enviada';
create trigger quote_requests_updated before update on public.quote_requests
  for each row execute function public.set_updated_at();

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.quote_requests (id),
  folio text unique,                         -- se asigna al enviar
  posicion integer not null default 1,
  producto text not null default '',
  descripcion text not null default '',
  cantidad numeric(14, 3) check (cantidad is null or cantidad > 0),
  unidad text check (unidad is null or unidad in
    ('pieza','caja','paquete','par','kg','litro','metro','otra')),
  talla text,
  notas text,
  estado public.item_status not null default 'pendiente',
  not_found_note text,
  first_response_at timestamptz,
  response_business_hours numeric(10, 2) check (response_business_hours is null or response_business_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cantidad is null or unidad is not null)
);
create index quote_items_request_idx on public.quote_items (request_id);
create index quote_items_estado_idx on public.quote_items (estado);
create trigger quote_items_updated before update on public.quote_items
  for each row execute function public.set_updated_at();

create table public.item_references (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.quote_items (id),
  tipo public.reference_kind not null,
  url text not null,                         -- link, o ruta en Storage para imagen
  created_at timestamptz not null default now(),
  check (tipo <> 'link' or url ~* '^https?://[^\s]+$')
);
create index item_references_item_idx on public.item_references (item_id);

-- ---------------------------------------------------------------------------
-- Respuesta del comprador
-- ---------------------------------------------------------------------------
-- Cada cotizacion es VERSIONADA: la primera es la version 1 y una revision futura
-- agrega la version 2, 3... (nunca se edita una version existente).
-- SOLO comprador: costos reales y datos del calculo.
create table public.item_costs (
  item_id uuid not null references public.quote_items (id),
  version smallint not null default 1 check (version >= 1),
  costo numeric(14, 4) not null check (costo >= 0),
  envio numeric(14, 4) check (envio is null or envio >= 0),
  base numeric(18, 8) not null,
  proveedor text,
  factors_snapshot jsonb not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (item_id, version)
);
create index item_costs_proveedor_idx on public.item_costs (lower(proveedor));

-- Visible al vendedor: precios finales y condiciones.
create table public.item_quotes (
  item_id uuid not null references public.quote_items (id),
  version smallint not null default 1 check (version >= 1),
  moneda public.currency not null,
  price_1 numeric(14, 2) not null,
  price_2 numeric(14, 2) not null,
  price_3 numeric(14, 2) not null,
  price_4 numeric(14, 2) not null,
  price_5 numeric(14, 2) not null,
  entrega_dias integer check (entrega_dias is null or entrega_dias >= 0),
  entrega_tipo public.delivery_kind,
  entrega_fecha date,
  compra_min_cantidad numeric(14, 3) check (compra_min_cantidad is null or compra_min_cantidad > 0),
  compra_min_unidad text,
  compra_min_monto numeric(14, 2) check (compra_min_monto is null or compra_min_monto > 0),
  nota text,
  -- Reservado para la vigencia de la cotizacion (fase 4). Hoy queda en null.
  valid_until timestamptz,
  quoted_at timestamptz not null default now(),
  quoted_by uuid not null references public.profiles (id),
  primary key (item_id, version),
  foreign key (item_id, version) references public.item_costs (item_id, version),
  check ((entrega_dias is not null and entrega_tipo is not null) or entrega_fecha is not null)
);

-- Registro de control de lo enviado al cliente (por version cotizada).
create table public.item_dispatch (
  item_id uuid not null references public.quote_items (id),
  quote_version smallint not null,
  precio_elegido smallint not null check (precio_elegido between 1 and 5),
  valor numeric(14, 2) not null,
  user_id uuid not null references public.profiles (id),
  enviado_at timestamptz not null default now(),
  primary key (item_id, quote_version),
  foreign key (item_id, quote_version) references public.item_quotes (item_id, version)
);

-- ---------------------------------------------------------------------------
-- Notificaciones dentro del portal
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  tipo text not null,
  titulo text not null,
  cuerpo text,
  link text,
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
-- Evita avisos duplicados (por vencer / vencida) para el mismo usuario y referencia.
create unique index notifications_dedupe_idx on public.notifications (user_id, tipo, ref_id)
  where tipo in ('por_vencer', 'vencida');

-- ---------------------------------------------------------------------------
-- Bitacora de auditoria (solo insercion)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  meta jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);


-- -----------------------------------------------------------------------------
-- 0002_guards.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- 0003_rpc.sql
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- 0004_rls.sql
-- -----------------------------------------------------------------------------

-- Row Level Security. Principio: todo cerrado por defecto, se abre lo minimo.

-- Helpers de acceso a solicitudes (security definer: sin recursion de RLS).
create or replace function public.can_read_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.quote_requests r
     where r.id = p_request
       and ((r.vendedor_id = auth.uid())
            or (public.is_buyer() and r.estado = 'enviada'))
  );
$$;

create or replace function public.is_own_draft(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() and exists (
    select 1 from public.quote_requests r
     where r.id = p_request and r.vendedor_id = auth.uid() and r.estado = 'borrador'
  );
$$;

create or replace function public.item_request_id(p_item uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select request_id from public.quote_items where id = p_item;
$$;

-- Permisos base: nada para anon, lectura para authenticated (filtrada por RLS).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select on public.profiles, public.app_settings, public.pricing_config, public.holidays,
  public.customers, public.quote_requests, public.quote_items, public.item_references,
  public.item_costs, public.item_quotes, public.item_dispatch, public.notifications,
  public.audit_log to authenticated;
grant execute on function public.is_enabled(), public.is_active_user(), public.is_buyer(), public.is_seller(),
  public.can_read_request(uuid), public.is_own_draft(uuid), public.item_request_id(uuid)
  to authenticated;

grant insert (nombre, tipo, created_by) on public.customers to authenticated;
grant update (nombre, tipo, activo, razon_social, rfc, direccion, contacto_nombre,
  contacto_correo, contacto_telefono) on public.customers to authenticated;
grant insert (id, vendedor_id, customer_id, notas, estado) on public.quote_requests to authenticated;
grant update (customer_id, notas, estado, due_at, archived_at) on public.quote_requests to authenticated;
grant insert (id, request_id, posicion, producto, descripcion, cantidad, unidad, talla, notas)
  on public.quote_items to authenticated;
grant update (posicion, producto, descripcion, cantidad, unidad, talla, notas)
  on public.quote_items to authenticated;
grant delete on public.quote_items to authenticated;
grant insert (id, item_id, tipo, url) on public.item_references to authenticated;
grant delete on public.item_references to authenticated;
grant insert (no_shipping_markup, p1, p2, p3, p4, p5, created_by) on public.pricing_config to authenticated;
grant update (timezone, sla_business_hours, warn_business_hours, updated_by, updated_at)
  on public.app_settings to authenticated;
grant insert, update, delete on public.holidays to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Ejecucion de RPC: solo usuarios autenticados (las funciones validan el rol).
do $$
declare f text;
begin
  foreach f in array array[
    'admin_create_profile(uuid,text,text,public.user_role)',
    'admin_update_user(uuid,text)',
    'admin_set_user_active(uuid,boolean)',
    'admin_flag_password_reset(uuid)',
    'complete_password_change()',
    'touch_login()',
    'log_event(text,text,text,jsonb)',
    'respond_item(uuid,text,jsonb)',
    'mark_item_dispatched(uuid,integer)',
    'save_draft(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Politicas
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.pricing_config enable row level security;
alter table public.holidays enable row level security;
alter table public.customers enable row level security;
alter table public.folio_counters enable row level security;
alter table public.quote_requests enable row level security;
alter table public.quote_items enable row level security;
alter table public.item_references enable row level security;
alter table public.item_costs enable row level security;
alter table public.item_quotes enable row level security;
alter table public.item_dispatch enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Perfiles: cada quien el suyo; el comprador todos. Escritura solo via RPC.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_buyer());

-- Configuracion
create policy settings_select on public.app_settings for select to authenticated
  using (public.is_active_user());
create policy settings_update on public.app_settings for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Factores del tabulador: el vendedor NO los ve.
create policy pricing_select on public.pricing_config for select to authenticated
  using (public.is_buyer());
create policy pricing_insert on public.pricing_config for insert to authenticated
  with check (public.is_buyer() and created_by = auth.uid());

create policy holidays_select on public.holidays for select to authenticated
  using (public.is_active_user());
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Clientes
create policy customers_select on public.customers for select to authenticated
  using (public.is_active_user());
create policy customers_insert on public.customers for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
create policy customers_update on public.customers for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Solicitudes
create policy requests_select on public.quote_requests for select to authenticated
  using (public.is_active_user() and
         (vendedor_id = auth.uid() or (public.is_buyer() and estado = 'enviada')));
create policy requests_insert on public.quote_requests for insert to authenticated
  with check (public.is_seller() and vendedor_id = auth.uid() and estado = 'borrador');
create policy requests_update on public.quote_requests for update to authenticated
  using (public.is_seller() and vendedor_id = auth.uid() and estado = 'borrador')
  with check (vendedor_id = auth.uid());

-- Partidas
create policy items_select on public.quote_items for select to authenticated
  using (public.can_read_request(request_id));
create policy items_insert on public.quote_items for insert to authenticated
  with check (public.is_own_draft(request_id));
create policy items_update on public.quote_items for update to authenticated
  using (public.is_own_draft(request_id)) with check (public.is_own_draft(request_id));
create policy items_delete on public.quote_items for delete to authenticated
  using (public.is_own_draft(request_id));

create policy refs_select on public.item_references for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));
create policy refs_insert on public.item_references for insert to authenticated
  with check (public.is_own_draft(public.item_request_id(item_id)));
create policy refs_delete on public.item_references for delete to authenticated
  using (public.is_own_draft(public.item_request_id(item_id)));

-- COSTOS: solo comprador. El vendedor no tiene ni lectura (privacidad en BD).
create policy costs_select on public.item_costs for select to authenticated
  using (public.is_buyer());

-- Precios finales: comprador y el vendedor dueno de la solicitud.
create policy quotes_select on public.item_quotes for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));
create policy dispatch_select on public.item_dispatch for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

-- Notificaciones propias
create policy notif_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bitacora: solo lectura para el comprador.
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_buyer());


-- -----------------------------------------------------------------------------
-- 0005_storage.sql
-- -----------------------------------------------------------------------------

-- Bucket privado para imagenes de referencia.
-- Ruta: {request_id}/{item_id}/{archivo}. El primer segmento es la solicitud.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('references', 'references', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_request_id(p_name text) returns uuid
language sql immutable as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$'
              then ((storage.foldername(p_name))[1])::uuid end;
$$;

grant execute on function public.storage_request_id(text) to authenticated;

create policy refs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'references' and public.can_read_request(public.storage_request_id(name)));
create policy refs_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'references' and public.is_own_draft(public.storage_request_id(name)));
create policy refs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'references' and public.is_own_draft(public.storage_request_id(name)));

