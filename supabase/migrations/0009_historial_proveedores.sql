-- =============================================================================
-- 0009_historial_proveedores.sql
-- Que hace: historial de precios y catalogo de proveedores (SOLO COMPRADOR).
--   * Extension pg_trgm e indice para buscar productos parecidos por nombre.
--   * suppliers: catalogo de proveedores (se llena solo al cotizar y con los ya capturados).
--   * similar_quotes(): "Cotizaciones anteriores parecidas" (por producto y/o proveedor).
--   * product_cost_history(): puntos de costo en el tiempo para la grafica por producto.
-- Privacidad: el vendedor no tiene SELECT en suppliers y las funciones rechazan a quien no sea
--   comprador activo.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0008_resultados.sql.
-- =============================================================================

begin;

create extension if not exists pg_trgm with schema extensions;
create index if not exists quote_items_producto_trgm_idx
  on public.quote_items using gin (producto extensions.gin_trgm_ops);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_nombre_key on public.suppliers (lower(trim(nombre)));
create trigger suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger suppliers_no_delete before delete on public.suppliers
  for each row execute function public.forbid_mutation();
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();

alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;
grant select on public.suppliers to authenticated;
grant insert (nombre) on public.suppliers to authenticated;
grant update (nombre, activo) on public.suppliers to authenticated;
create policy suppliers_select on public.suppliers for select to authenticated using (public.is_buyer());
create policy suppliers_insert on public.suppliers for insert to authenticated with check (public.is_buyer());
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Alta automatica del proveedor al registrar un costo.
create or replace function public.item_costs_supplier() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.proveedor is not null and length(trim(new.proveedor)) > 0 then
    insert into public.suppliers (nombre) values (trim(new.proveedor)) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger item_costs_supplier after insert on public.item_costs
  for each row execute function public.item_costs_supplier();

-- Proveedores ya capturados.
insert into public.suppliers (nombre)
select distinct trim(proveedor) from public.item_costs
 where proveedor is not null and length(trim(proveedor)) > 0
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Cotizaciones anteriores parecidas (por similitud de nombre y/o proveedor)
-- ---------------------------------------------------------------------------
create or replace function public.similar_quotes(
  p_name text default null, p_proveedor text default null, p_exclude_item uuid default null, p_limit integer default 15
) returns table (
  item_id uuid, version smallint, folio text, producto text, cliente text, quoted_at timestamptz,
  costo numeric, envio numeric, moneda public.currency, proveedor text,
  precio_elegido smallint, valor_elegido numeric, resultado public.outcome_result, similitud real
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_name text := nullif(trim(coalesce(p_name, '')), ''); v_prov text := nullif(trim(coalesce(p_proveedor, '')), '');
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_name is null and v_prov is null then return; end if;
  return query
    select i.id, k.version, i.folio, i.producto, c.nombre, q.quoted_at,
           k.costo, k.envio, q.moneda, k.proveedor,
           d.precio_elegido, d.valor, o.resultado,
           case when v_name is null then 1::real else similarity(i.producto, v_name) end
      from public.item_costs k
      join public.item_quotes q on q.item_id = k.item_id and q.version = k.version
      join public.quote_items i on i.id = k.item_id
      join public.quote_requests r on r.id = i.request_id
      join public.customers c on c.id = r.customer_id
      left join public.item_dispatch d on d.item_id = k.item_id and d.quote_version = k.version
      left join public.item_outcomes o on o.item_id = k.item_id and o.quote_version = k.version
     where (p_exclude_item is null or i.id <> p_exclude_item)
       and (v_name is null or similarity(i.producto, v_name) >= 0.3 or i.producto ilike '%' || v_name || '%')
       and (v_prov is null or k.proveedor ilike '%' || v_prov || '%')
     order by 14 desc, q.quoted_at desc
     limit greatest(1, least(coalesce(p_limit, 15), 100));
end $$;

-- ---------------------------------------------------------------------------
-- Historial de costo por producto (para la grafica)
-- ---------------------------------------------------------------------------
create or replace function public.product_cost_history(p_name text, p_limit integer default 300)
returns table (
  item_id uuid, version smallint, folio text, producto text, quoted_at timestamptz,
  costo numeric, envio numeric, moneda public.currency, proveedor text
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v_name is null then return; end if;
  return query
    select i.id, k.version, i.folio, i.producto, q.quoted_at, k.costo, k.envio, q.moneda, k.proveedor
      from public.item_costs k
      join public.item_quotes q on q.item_id = k.item_id and q.version = k.version
      join public.quote_items i on i.id = k.item_id
     where similarity(i.producto, v_name) >= 0.4 or i.producto ilike '%' || v_name || '%'
     order by q.quoted_at
     limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

-- Permisos
revoke all on function public.similar_quotes(text, text, uuid, integer) from public, anon;
grant execute on function public.similar_quotes(text, text, uuid, integer) to authenticated;
revoke all on function public.product_cost_history(text, integer) from public, anon;
grant execute on function public.product_cost_history(text, integer) to authenticated;
revoke all on function public.item_costs_supplier() from public, anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select extname from pg_extension where extname = 'pg_trgm';                  -- 1 fila
--   select count(*) as proveedores from public.suppliers;                         -- >= 0
--   select proname from pg_proc where proname in ('similar_quotes', 'product_cost_history')
--    and pronamespace = 'public'::regnamespace;                                   -- 2 filas
-- -----------------------------------------------------------------------------
