-- =============================================================================
-- 0059_planeacion_compras.sql
-- PLANEACION DE COMPRAS (solo el comprador):
--  * Proveedores de planeacion (las hojas del Excel PRODUCTOS 2026): origen China o USA, dias de entrega,
--    si recibe parcial (topglove) o la orden llega completa (chinos), tope por OC y CBM del contenedor.
--  * Articulos por proveedor: clave ESC, codigo y descripcion del proveedor, empaque, CBM por caja y precio.
--  * Corte de existencias: la existencia de Microsip a una fecha (kardex). NO toca el inventario de almacen
--    de la app: es solo para planear. Despues del corte se descuentan las ventas registradas en el portal
--    y se suman las OCs que se reciben.
--  * Historial mensual de venta por articulo (sale del kardex) para calcular la venta real.
--  * Ordenes de compra: borrador, enviada, proforma (cantidades que confirma el proveedor),
--    embarcada, recibida o cancelada. Las lineas guardan lo pedido, lo de la proforma y lo recibido.
-- La carga inicial esta en supabase/cargas/planeacion_compras_inicial.sql (correrla despues de esta).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.plan_proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (length(trim(nombre)) between 1 and 80),
  codigo text check (codigo is null or codigo ~ '^[A-Z]{2,4}$'),
  origen text not null check (origen in ('china', 'usa')),
  entrega_dias int not null default 30 check (entrega_dias between 1 and 400),
  recibe_parcial boolean not null default false,
  tope_usd numeric(14, 2) check (tope_usd is null or tope_usd > 0),
  contenedor_cbm numeric(8, 2) check (contenedor_cbm is null or contenedor_cbm > 0),
  base_meses numeric(5, 2) not null default 2,
  objetivo_meses numeric(5, 2) not null default 3,
  punto_meses numeric(5, 2) not null default 6,
  cobertura_meses numeric(5, 2) not null default 9,
  moneda text not null default 'USD' check (moneda in ('USD', 'MXN')),
  orden int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_articulos (
  clave text primary key check (length(trim(clave)) between 1 and 60),
  proveedor_id uuid not null references public.plan_proveedores (id),
  nombre text not null check (length(trim(nombre)) between 1 and 400),
  um text,
  codigo_proveedor text,
  descripcion_proveedor text,
  empaque numeric(14, 3) check (empaque is null or empaque > 0),
  cbm_empaque numeric(10, 5) check (cbm_empaque is null or cbm_empaque >= 0),
  precio numeric(14, 4) check (precio is null or precio >= 0),
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists plan_articulos_prov_idx on public.plan_articulos (proveedor_id);

create table if not exists public.plan_cortes (
  id uuid primary key default gen_random_uuid(),
  fecha date not null unique,
  fuente text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.plan_existencias (
  corte_id uuid not null references public.plan_cortes (id) on delete cascade,
  clave text not null,
  existencia numeric(14, 3) not null,
  primary key (corte_id, clave)
);

create table if not exists public.plan_historial (
  clave text not null,
  mes date not null check (extract(day from mes) = 1),
  venta numeric(14, 3) not null default 0,
  traspasos numeric(14, 3) not null default 0,
  dias_stock int not null default 0,
  dias int not null default 0,
  existencia_fin numeric(14, 3),
  entradas numeric(14, 3) not null default 0,
  primary key (clave, mes)
);

create table if not exists public.plan_ocs (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique check (length(trim(folio)) between 3 and 40),
  proveedor_id uuid not null references public.plan_proveedores (id),
  fecha date not null default current_date,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'proforma', 'embarcada', 'recibida', 'cancelada')),
  llegada_estimada date,
  recibida_fecha date,
  proforma_path text,
  proforma_nombre text,
  notas text check (notas is null or length(notas) <= 2000),
  origen text not null default 'portal' check (origen in ('excel', 'portal')),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_ocs_prov_idx on public.plan_ocs (proveedor_id, fecha desc);

create table if not exists public.plan_oc_lineas (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.plan_ocs (id) on delete cascade,
  clave text not null,
  cantidad numeric(14, 3) not null check (cantidad > 0),
  cantidad_proforma numeric(14, 3) check (cantidad_proforma is null or cantidad_proforma >= 0),
  recibido numeric(14, 3) not null default 0 check (recibido >= 0),
  recibido_fecha date,
  precio numeric(14, 4) check (precio is null or precio >= 0),
  unique (oc_id, clave)
);
create index if not exists plan_oc_lineas_clave_idx on public.plan_oc_lineas (clave);

drop trigger if exists plan_proveedores_updated on public.plan_proveedores;
create trigger plan_proveedores_updated before update on public.plan_proveedores for each row execute function public.set_updated_at();
drop trigger if exists plan_articulos_updated on public.plan_articulos;
create trigger plan_articulos_updated before update on public.plan_articulos for each row execute function public.set_updated_at();
drop trigger if exists plan_ocs_updated on public.plan_ocs;
create trigger plan_ocs_updated before update on public.plan_ocs for each row execute function public.set_updated_at();
drop trigger if exists plan_ocs_audit on public.plan_ocs;
create trigger plan_ocs_audit after update on public.plan_ocs for each row execute function public.audit_row();

-- Una OC recibida guarda su fecha; si se recibe completa (chinos) cada linea toma lo de la proforma (o lo pedido).
create or replace function public.plan_ocs_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'recibida' and (tg_op = 'INSERT' or old.estado is distinct from 'recibida') then
    new.recibida_fecha := coalesce(new.recibida_fecha, current_date);
  elsif new.estado <> 'recibida' then
    new.recibida_fecha := null;
  end if;
  return new;
end;
$$;
drop trigger if exists plan_ocs_before on public.plan_ocs;
create trigger plan_ocs_before before insert or update on public.plan_ocs for each row execute function public.plan_ocs_before();

-- Solo el comprador. Nada de esto se ve en almacen ni en ventas.
do $$
declare t text;
begin
  foreach t in array array['plan_proveedores', 'plan_articulos', 'plan_cortes', 'plan_existencias', 'plan_historial', 'plan_ocs', 'plan_oc_lineas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_comprador', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_buyer()) with check (public.is_buyer())', t || '_comprador', t);
  end loop;
end $$;

-- Archivos de proformas de las OCs de planeacion.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compras', 'compras', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists compras_storage_select on storage.objects;
create policy compras_storage_select on storage.objects for select to authenticated using (bucket_id = 'compras' and public.is_buyer());
drop policy if exists compras_storage_insert on storage.objects;
create policy compras_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'compras' and public.is_buyer());
drop policy if exists compras_storage_delete on storage.objects;
create policy compras_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'compras' and public.is_buyer());

commit;
