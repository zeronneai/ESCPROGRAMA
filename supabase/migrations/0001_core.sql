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
