-- =============================================================================
-- 0053_catalogo_aviso_pegatron.sql
-- 1) Catalogo nuevo: aviso en ventana para todos (una vez por version) y comentarios o sugerencias
--    que llegan al comprador.
-- 2) Pedidos Pegatron: la jefa de ventas sube la orden de compra (PDF) de Pegatron y en cada renglon
--    pone el articulo ESC; el comprador ve descripcion, cantidad y articulo ESC y marca "Pedido".
-- Se puede correr en cualquier momento.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) Catalogo: quien ya vio el aviso y comentarios
-- ---------------------------------------------------------------------------
create table public.catalogo_vistos (
  user_id uuid not null references public.profiles (id) default auth.uid(),
  version text not null check (length(version) <= 40),
  visto_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.catalogo_vistos enable row level security;
create policy catalogo_vistos_select on public.catalogo_vistos for select to authenticated using (user_id = auth.uid());
create policy catalogo_vistos_insert on public.catalogo_vistos for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.catalogo_vistos to authenticated;

create table public.catalogo_comentarios (
  id uuid primary key default gen_random_uuid(),
  version text not null check (length(version) <= 40),
  texto text not null check (length(trim(texto)) between 3 and 2000),
  created_by uuid not null references public.profiles (id) default auth.uid(),
  autor_nombre text,
  autor_rol text,
  revisado_at timestamptz,
  created_at timestamptz not null default now()
);
create index catalogo_comentarios_fecha on public.catalogo_comentarios (created_at desc);
alter table public.catalogo_comentarios enable row level security;
create policy catalogo_comentarios_select on public.catalogo_comentarios for select to authenticated
  using (created_by = auth.uid() or public.is_buyer());
create policy catalogo_comentarios_insert on public.catalogo_comentarios for insert to authenticated
  with check (created_by = auth.uid());
create policy catalogo_comentarios_update on public.catalogo_comentarios for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());
grant select, insert (version, texto) on public.catalogo_comentarios to authenticated;
grant update (revisado_at) on public.catalogo_comentarios to authenticated;

create or replace function public.catalogo_comentario_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid();
  select nombre, rol into new.autor_nombre, new.autor_rol from public.profiles where id = auth.uid();
  new.texto := trim(new.texto);
  return new;
end $$;
create trigger catalogo_comentario_before before insert on public.catalogo_comentarios
  for each row execute function public.catalogo_comentario_before();

create or replace function public.catalogo_comentario_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_role('comprador', 'catalogo_comentario', 'Comentario del catálogo: ' || coalesce(new.autor_nombre, ''),
                             left(new.texto, 160), '/comprador/catalogo', new.id);
  return null;
end $$;
create trigger catalogo_comentario_after after insert on public.catalogo_comentarios
  for each row execute function public.catalogo_comentario_after();

-- ---------------------------------------------------------------------------
-- 2) Pedidos Pegatron
-- ---------------------------------------------------------------------------
create or replace function public.pegatron_puede_ver() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo
                 and rol in ('jefe_ventas', 'comprador', 'gerente', 'ceo'));
$$;
create or replace function public.pegatron_puede_subir() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and rol = 'jefe_ventas');
$$;
grant execute on function public.pegatron_puede_ver(), public.pegatron_puede_subir() to authenticated;

create sequence public.pegatron_oc_seq;
create table public.pegatron_oc (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique default 'PG-' || lpad(nextval('public.pegatron_oc_seq')::text, 4, '0'),
  po_numero text not null check (length(po_numero) between 3 and 40),
  fecha date,
  moneda text check (moneda is null or moneda in ('MXN', 'USD')),
  archivo_path text,
  archivo_nombre text check (archivo_nombre is null or length(archivo_nombre) <= 200),
  notas text check (notas is null or length(notas) <= 1000),
  created_by uuid references public.profiles (id) default auth.uid(),
  autor_nombre text,
  created_at timestamptz not null default now()
);
create unique index pegatron_oc_po_unica on public.pegatron_oc (upper(po_numero));

create table public.pegatron_oc_lineas (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.pegatron_oc (id) on delete cascade,
  posicion integer not null,
  item text check (item is null or length(item) <= 20),
  numero_parte text check (numero_parte is null or length(numero_parte) <= 80),
  descripcion text not null check (length(descripcion) between 1 and 500),
  cantidad numeric(14, 3) not null check (cantidad > 0),
  unidad text check (unidad is null or length(unidad) <= 20),
  entrega date,
  articulo_esc text not null check (length(trim(articulo_esc)) between 2 and 200),
  pedido_at timestamptz,
  pedido_por uuid references public.profiles (id),
  pedido_nombre text,
  unique (oc_id, posicion)
);
create index pegatron_lineas_oc on public.pegatron_oc_lineas (oc_id);

alter table public.pegatron_oc enable row level security;
alter table public.pegatron_oc_lineas enable row level security;
create policy pegatron_oc_select on public.pegatron_oc for select to authenticated using (public.pegatron_puede_ver());
create policy pegatron_lineas_select on public.pegatron_oc_lineas for select to authenticated using (public.pegatron_puede_ver());
-- La jefa corrige el articulo ESC mientras no este pedido.
create policy pegatron_lineas_update on public.pegatron_oc_lineas for update to authenticated
  using (public.pegatron_puede_subir() and pedido_at is null) with check (public.pegatron_puede_subir());
grant select on public.pegatron_oc, public.pegatron_oc_lineas to authenticated;
grant update (articulo_esc) on public.pegatron_oc_lineas to authenticated;

-- Alta de la OC con sus renglones (todo o nada).
create or replace function public.pegatron_crear(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_po text := upper(trim(coalesce(p ->> 'po_numero', ''))); l jsonb; i integer := 0;
begin
  if not public.pegatron_puede_subir() then raise exception 'Solo la jefa de ventas sube pedidos de Pegatron' using errcode = '42501'; end if;
  if length(v_po) < 3 then raise exception 'Falta el numero de la orden de compra (P/O)'; end if;
  if exists (select 1 from public.pegatron_oc where upper(po_numero) = v_po) then
    raise exception 'La orden de compra % ya se subio', v_po;
  end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'La orden no tiene renglones'; end if;
  if jsonb_array_length(p -> 'lineas') > 200 then raise exception 'Demasiados renglones'; end if;
  insert into public.pegatron_oc (po_numero, fecha, moneda, notas, autor_nombre)
  values (v_po, nullif(p ->> 'fecha', '')::date, nullif(p ->> 'moneda', ''), nullif(left(trim(coalesce(p ->> 'notas', '')), 1000), ''), public.my_name())
  returning id into v_id;
  for l in select * from jsonb_array_elements(p -> 'lineas') loop
    i := i + 1;
    if length(trim(coalesce(l ->> 'articulo_esc', ''))) < 2 then
      raise exception 'Renglon %: escribe el articulo ESC', i;
    end if;
    insert into public.pegatron_oc_lineas (oc_id, posicion, item, numero_parte, descripcion, cantidad, unidad, entrega, articulo_esc)
    values (v_id, i, nullif(left(l ->> 'item', 20), ''), nullif(left(l ->> 'numero_parte', 80), ''), left(trim(l ->> 'descripcion'), 500),
            (l ->> 'cantidad')::numeric, nullif(left(l ->> 'unidad', 20), ''), nullif(l ->> 'entrega', '')::date, left(trim(l ->> 'articulo_esc'), 200));
  end loop;
  perform public.notify_role('comprador', 'pegatron_oc', 'Pedido Pegatron ' || v_po,
                             i || ' articulo(s) por pedir', '/pedidos-pegatron/' || v_id, v_id);
  return v_id;
end $$;
revoke all on function public.pegatron_crear(jsonb) from public, anon;
grant execute on function public.pegatron_crear(jsonb) to authenticated;

-- Archivo de la OC (lo pone la jefa justo despues de crearla).
create or replace function public.pegatron_archivo(p_id uuid, p_path text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pegatron_puede_subir() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_path not like p_id::text || '/%' then raise exception 'Archivo invalido'; end if;
  update public.pegatron_oc set archivo_path = p_path, archivo_nombre = left(coalesce(p_nombre, 'orden.pdf'), 200) where id = p_id;
end $$;
revoke all on function public.pegatron_archivo(uuid, text, text) from public, anon;
grant execute on function public.pegatron_archivo(uuid, text, text) to authenticated;

-- El comprador marca (o desmarca) que ya pidio el articulo.
create or replace function public.pegatron_pedido(p_linea uuid, p_pedido boolean) returns void
language plpgsql security definer set search_path = public as $$
declare l public.pegatron_oc_lineas; o public.pegatron_oc;
begin
  if not public.is_buyer() then raise exception 'Solo el comprador marca lo pedido' using errcode = '42501'; end if;
  update public.pegatron_oc_lineas
     set pedido_at = case when p_pedido then now() end,
         pedido_por = case when p_pedido then auth.uid() end,
         pedido_nombre = case when p_pedido then public.my_name() end
   where id = p_linea
   returning * into l;
  if l.id is null then raise exception 'Renglon no encontrado'; end if;
  select * into o from public.pegatron_oc where id = l.oc_id;
  if p_pedido then
    perform public.notify_role('jefe_ventas', 'pegatron_pedido', 'Ya se pidió: ' || l.articulo_esc,
      'OC Pegatron ' || o.po_numero || ' · ' || trim(to_char(l.cantidad, 'FM999,999,990.###')) || coalesce(' ' || l.unidad, ''),
      '/pedidos-pegatron/' || o.id, o.id);
  end if;
end $$;
revoke all on function public.pegatron_pedido(uuid, boolean) from public, anon;
grant execute on function public.pegatron_pedido(uuid, boolean) to authenticated;

-- Archivos: bucket privado, carpeta = id de la OC.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pegatron', 'pegatron', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy pegatron_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'pegatron' and public.pegatron_puede_ver());
create policy pegatron_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pegatron' and public.pegatron_puede_subir()
              and exists (select 1 from public.pegatron_oc o where o.id = public.storage_first_uuid(name)));

-- Aviso a todos del catalogo nuevo (al llegar el aviso, la ventana del catalogo sale en el portal).
insert into public.notifications (user_id, tipo, titulo, cuerpo, link)
select id, 'catalogo', 'Ya está el Catálogo ESC 2026', 'Ábrelo, úsalo con tus clientes y déjanos tus comentarios o sugerencias.', '/catalogo'
  from public.profiles where activo;

-- Tiempo real
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.pegatron_oc, public.pegatron_oc_lineas, public.catalogo_comentarios;
  end if;
end $$;

commit;
