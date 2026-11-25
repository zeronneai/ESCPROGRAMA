-- =============================================================================
-- 0078_pedidos_vendedores.sql   (requiere 0059)
-- PEDIDOS DE VENDEDORES Y ASISTENTE DE COMPRAS:
--  * Los vendedores (y la jefa, gerente y CEO) piden articulos al comprador: del kardex de planeacion (por clave
--    o nombre) o "otro" (producto nuevo o de una cotizacion que se gano), con cantidad y frecuencia:
--    unica, semanal, mensual o anual.
--  * Unica = pedido especial: en cuanto el articulo entra en una OC queda "pedido" con el folio. Si la OC se
--    cancela, se borra o se quita el renglon, el pedido vuelve a quedar activo.
--  * Semanal, mensual y anual = demanda que se suma en cada planeacion mientras este activo.
--  * El vendedor ve en que OC va su pedido y cuando llega (sin ver precios ni proveedores).
--  * Asistente de compras (Claude): reglas que el comprador le deja escritas y registro de uso (tokens).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.pedidos_vendedor (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.profiles (id) default auth.uid(),
  clave text references public.plan_articulos (clave) on update cascade on delete set null,
  descripcion text not null check (length(trim(descripcion)) between 1 and 400),
  cantidad numeric(14, 3) not null check (cantidad > 0),
  um text check (um is null or length(um) <= 30),
  frecuencia text not null check (frecuencia in ('unica', 'semanal', 'mensual', 'anual')),
  cliente text check (cliente is null or length(cliente) <= 200),
  notas text check (notas is null or length(notas) <= 1000),
  estado text not null default 'activo' check (estado in ('activo', 'pedido', 'cancelado')),
  oc_id uuid references public.plan_ocs (id) on delete set null,
  oc_folio text,
  pedido_at timestamptz,
  nota_comprador text check (nota_comprador is null or length(nota_comprador) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pedidos_vendedor_clave_idx on public.pedidos_vendedor (clave) where estado = 'activo';
create index if not exists pedidos_vendedor_vend_idx on public.pedidos_vendedor (vendedor_id, created_at desc);

drop trigger if exists pedidos_vendedor_updated on public.pedidos_vendedor;
create trigger pedidos_vendedor_updated before update on public.pedidos_vendedor for each row execute function public.set_updated_at();

-- Quien puede pedir: vendedores, jefa, gerente y CEO.
create or replace function public.puede_pedir() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() or public.is_gerente();
$$;

-- El vendedor no cambia lo que el comprador ya cerro; solo cancela o corrige mientras esta activo.
create or replace function public.pedidos_vendedor_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_buyer() or current_setting('esc.sistema', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.vendedor_id := auth.uid();
    new.estado := 'activo';
    new.oc_id := null; new.oc_folio := null; new.pedido_at := null; new.nota_comprador := null;
    return new;
  end if;
  if old.estado <> 'activo' then raise exception 'Este pedido ya lo atendió el comprador' using errcode = '42501'; end if;
  if new.estado not in ('activo', 'cancelado') or new.vendedor_id <> old.vendedor_id or new.oc_id is distinct from old.oc_id
     or new.oc_folio is distinct from old.oc_folio or new.pedido_at is distinct from old.pedido_at or new.nota_comprador is distinct from old.nota_comprador then
    raise exception 'Solo puedes corregir o cancelar tu pedido' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists pedidos_vendedor_guard on public.pedidos_vendedor;
create trigger pedidos_vendedor_guard before insert or update on public.pedidos_vendedor for each row execute function public.pedidos_vendedor_guard();

alter table public.pedidos_vendedor enable row level security;
revoke all on public.pedidos_vendedor from anon, authenticated;
grant select, insert, update on public.pedidos_vendedor to authenticated;
drop policy if exists pedidos_vendedor_select on public.pedidos_vendedor;
create policy pedidos_vendedor_select on public.pedidos_vendedor for select to authenticated
  using (vendedor_id = auth.uid() or public.is_buyer() or public.is_gerente() or public.is_sales_manager());
drop policy if exists pedidos_vendedor_insert on public.pedidos_vendedor;
create policy pedidos_vendedor_insert on public.pedidos_vendedor for insert to authenticated
  with check (public.puede_pedir() and vendedor_id = auth.uid());
drop policy if exists pedidos_vendedor_update on public.pedidos_vendedor;
create policy pedidos_vendedor_update on public.pedidos_vendedor for update to authenticated
  using (public.is_buyer() or (vendedor_id = auth.uid() and estado = 'activo'))
  with check (public.is_buyer() or vendedor_id = auth.uid());

-- Buscador del kardex para los vendedores (solo clave, nombre y unidad: sin precio ni proveedor).
create or replace function public.plan_articulos_buscar(p_q text)
returns table (clave text, nombre text, um text)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, ''));
begin
  if not (public.puede_pedir() or public.is_buyer()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if length(q) < 2 then return; end if;
  return query
    select a.clave, a.nombre, a.um from public.plan_articulos a
    where a.activo and (a.clave ilike '%' || q || '%' or a.nombre ilike '%' || q || '%'
      or (select bool_and(a.clave || ' ' || a.nombre ilike '%' || w || '%') from unnest(regexp_split_to_array(q, '\s+')) w))
    order by (upper(a.clave) = upper(q)) desc, (a.clave ilike q || '%') desc, a.clave
    limit 30;
end;
$$;
revoke all on function public.plan_articulos_buscar(text) from public, anon;
grant execute on function public.plan_articulos_buscar(text) to authenticated;

-- Mis pedidos con el folio de la OC, su estado y cuando llega (el vendedor no lee plan_ocs).
create or replace function public.pedidos_vendedor_mios()
returns table (id uuid, clave text, descripcion text, cantidad numeric, um text, frecuencia text, cliente text, notas text,
  estado text, oc_folio text, oc_estado text, llegada_estimada date, recibida_fecha date, pedido_at timestamptz,
  nota_comprador text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.clave, p.descripcion, p.cantidad, p.um, p.frecuencia, p.cliente, p.notas, p.estado,
    coalesce(o.folio, p.oc_folio), o.estado, o.llegada_estimada, o.recibida_fecha, p.pedido_at, p.nota_comprador, p.created_at
  from public.pedidos_vendedor p
  left join public.plan_ocs o on o.id = p.oc_id
  where p.vendedor_id = auth.uid()
  order by (p.estado = 'activo') desc, p.created_at desc
  limit 300;
$$;
revoke all on function public.pedidos_vendedor_mios() from public, anon;
grant execute on function public.pedidos_vendedor_mios() to authenticated;

-- Un articulo entra a una OC: sus pedidos unicos activos quedan pedidos con ese folio.
create or replace function public.plan_oc_lineas_pedidos() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_folio text;
begin
  perform set_config('esc.sistema', 'on', true);
  if tg_op = 'INSERT' then
    select folio into v_folio from public.plan_ocs where id = new.oc_id;
    update public.pedidos_vendedor set estado = 'pedido', oc_id = new.oc_id, oc_folio = v_folio, pedido_at = now()
      where clave = new.clave and frecuencia = 'unica' and estado = 'activo';
  elsif tg_op = 'DELETE' then
    update public.pedidos_vendedor set estado = 'activo', oc_id = null, oc_folio = null, pedido_at = null
      where oc_id = old.oc_id and clave = old.clave and estado = 'pedido';
  end if;
  perform set_config('esc.sistema', 'off', true);
  return null;
end;
$$;
drop trigger if exists plan_oc_lineas_pedidos on public.plan_oc_lineas;
create trigger plan_oc_lineas_pedidos after insert or delete on public.plan_oc_lineas for each row execute function public.plan_oc_lineas_pedidos();

-- La OC se cancela o se borra: los pedidos unicos vuelven a quedar activos.
create or replace function public.plan_ocs_pedidos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('esc.sistema', 'on', true);
  if tg_op = 'DELETE' then
    update public.pedidos_vendedor set estado = 'activo', oc_id = null, oc_folio = null, pedido_at = null where oc_id = old.id and estado = 'pedido';
  elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then
    update public.pedidos_vendedor set estado = 'activo', oc_id = null, oc_folio = null, pedido_at = null where oc_id = new.id and estado = 'pedido';
  elsif old.estado = 'cancelada' and new.estado <> 'cancelada' then
    update public.pedidos_vendedor p set estado = 'pedido', oc_id = new.id, oc_folio = new.folio, pedido_at = now()
      from public.plan_oc_lineas l where l.oc_id = new.id and l.clave = p.clave and p.frecuencia = 'unica' and p.estado = 'activo';
  end if;
  perform set_config('esc.sistema', 'off', true);
  return coalesce(new, old);
end;
$$;
drop trigger if exists plan_ocs_pedidos on public.plan_ocs;
create trigger plan_ocs_pedidos before delete or update of estado on public.plan_ocs for each row execute function public.plan_ocs_pedidos();
-- (before: al borrar, los pedidos se reabren antes de que el on delete set null borre el oc_id)

-- Asistente de compras: reglas que el comprador le deja escritas (tope por OC, cada cuanto pedir, etc.).
create table if not exists public.plan_asistente (
  id int primary key default 1 check (id = 1),
  reglas text not null default '' check (length(reglas) <= 8000),
  updated_at timestamptz not null default now()
);
insert into public.plan_asistente (id) values (1) on conflict do nothing;
create table if not exists public.plan_asistente_uso (
  id bigint generated always as identity primary key,
  usuario uuid references public.profiles (id) default auth.uid(),
  modelo text not null,
  entrada int not null default 0,
  salida int not null default 0,
  created_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['plan_asistente', 'plan_asistente_uso'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_comprador', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_buyer()) with check (public.is_buyer())', t || '_comprador', t);
  end loop;
end $$;

-- El vendedor ve al momento cuando su pedido queda en una OC.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pedidos_vendedor') then
    execute 'alter publication supabase_realtime add table public.pedidos_vendedor';
  end if;
end $$;

commit;
