-- =============================================================================
-- 0012_abastecimiento.sql
-- Que hace: "Donde conseguir el producto" (SOLO COMPRADOR). Informacion interna para saber a donde ir
--           cuando una cotizacion es aprobada. El vendedor NUNCA la ve.
--   * item_sourcing: una fila por partida (no por version): proveedor, link, contacto, numero de
--     parte y notas de compra. No se bloquea con la cotizacion (no afecta precios).
--   * item_purchases: marca "Comprada" (fecha y usuario).
--   * save_item_sourcing(), get_item_sourcing(), mark_item_purchased() y por_comprar():
--     funciones solo para comprador activo. Todo cambio queda en la bitacora (valor anterior y nuevo).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0009_historial_proveedores.sql (suppliers) y 0008_resultados.sql (item_outcomes).
-- =============================================================================

begin;

create table public.item_sourcing (
  item_id uuid primary key references public.quote_items (id),
  supplier_id uuid references public.suppliers (id),
  proveedor text,
  link_producto text check (link_producto is null or link_producto ~* '^https?://[^\s]+$'),
  contacto text,
  numero_parte text,
  notas_compra text,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger item_sourcing_updated before update on public.item_sourcing
  for each row execute function public.set_updated_at();
create trigger item_sourcing_no_delete before delete on public.item_sourcing
  for each row execute function public.forbid_mutation();
create trigger item_sourcing_audit after insert or update or delete on public.item_sourcing
  for each row execute function public.audit_row();

create table public.item_purchases (
  item_id uuid primary key references public.quote_items (id),
  comprada_at timestamptz,
  comprada_by uuid references public.profiles (id),
  check ((comprada_at is null) = (comprada_by is null))
);
create trigger item_purchases_no_delete before delete on public.item_purchases
  for each row execute function public.forbid_mutation();
create trigger item_purchases_audit after insert or update or delete on public.item_purchases
  for each row execute function public.audit_row();

alter table public.item_sourcing enable row level security;
alter table public.item_purchases enable row level security;
revoke all on public.item_sourcing, public.item_purchases from anon, authenticated;
grant select on public.item_sourcing, public.item_purchases to authenticated;
-- Solo comprador activo; los vendedores no tienen politica de lectura (ni escritura).
create policy sourcing_select on public.item_sourcing for select to authenticated using (public.is_buyer());
create policy purchases_select on public.item_purchases for select to authenticated using (public.is_buyer());

-- ---------------------------------------------------------------------------
-- Captura / edicion (el comprador puede editar aunque la partida ya este cotizada)
-- ---------------------------------------------------------------------------
create or replace function public.save_item_sourcing(
  p_item uuid, p_proveedor text, p_link text, p_contacto text, p_parte text, p_notas text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_prov text := nullif(trim(coalesce(p_proveedor, '')), ''); v_sup uuid; v_link text := nullif(trim(coalesce(p_link, '')), '');
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not exists (select 1 from public.quote_items where id = p_item) then raise exception 'Partida no encontrada'; end if;
  if v_link is not null and v_link !~* '^https?://[^\s]+$' then
    raise exception 'El link debe iniciar con http:// o https://';
  end if;
  if v_prov is not null then
    insert into public.suppliers (nombre) values (v_prov) on conflict do nothing;
    select id into v_sup from public.suppliers where lower(trim(nombre)) = lower(v_prov);
  end if;
  insert into public.item_sourcing (item_id, supplier_id, proveedor, link_producto, contacto, numero_parte, notas_compra,
                                    created_by, updated_by)
  values (p_item, v_sup, v_prov, v_link, nullif(trim(coalesce(p_contacto, '')), ''),
          nullif(trim(coalesce(p_parte, '')), ''), nullif(trim(coalesce(p_notas, '')), ''), auth.uid(), auth.uid())
  on conflict (item_id) do update set
    supplier_id = excluded.supplier_id, proveedor = excluded.proveedor, link_producto = excluded.link_producto,
    contacto = excluded.contacto, numero_parte = excluded.numero_parte, notas_compra = excluded.notas_compra,
    updated_by = auth.uid();
end $$;

-- Para "Usar como base" del historial: precarga el abastecimiento de otra partida.
create or replace function public.get_item_sourcing(p_item uuid)
returns table (proveedor text, link_producto text, contacto text, numero_parte text, notas_compra text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query select s.proveedor, s.link_producto, s.contacto, s.numero_parte, s.notas_compra
                 from public.item_sourcing s where s.item_id = p_item;
end $$;

create or replace function public.mark_item_purchased(p_item uuid, p_comprada boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not exists (select 1 from public.quote_items where id = p_item) then raise exception 'Partida no encontrada'; end if;
  insert into public.item_purchases (item_id, comprada_at, comprada_by)
  values (p_item, case when p_comprada then now() end, case when p_comprada then auth.uid() end)
  on conflict (item_id) do update set
    comprada_at = case when p_comprada then now() end,
    comprada_by = case when p_comprada then auth.uid() end;
end $$;

-- ---------------------------------------------------------------------------
-- Vista "Por comprar": partidas con resultado GANADA (de la version enviada mas reciente)
-- ---------------------------------------------------------------------------
create or replace function public.por_comprar(
  p_proveedor text default null, p_desde timestamptz default null, p_hasta timestamptz default null, p_estado text default 'todas'
) returns table (
  item_id uuid, request_id uuid, folio text, cliente text, producto text, cantidad numeric, unidad text, talla text,
  proveedor text, link_producto text, contacto text, numero_parte text, notas_compra text,
  costo numeric, envio numeric, moneda public.currency, version smallint,
  ganada_at timestamptz, comprada_at timestamptz, comprada_por text, falta_proveedor boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_prov text := nullif(trim(coalesce(p_proveedor, '')), '');
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  return query
    select i.id, r.id, i.folio, c.nombre, i.producto,
           coalesce(o.cantidad_final, i.cantidad), i.unidad, i.talla,
           s.proveedor, s.link_producto, s.contacto, s.numero_parte, s.notas_compra,
           k.costo, k.envio, q.moneda, k.version,
           o.updated_at, pu.comprada_at, pr.nombre,
           (s.item_id is null or (s.proveedor is null and s.link_producto is null))
      from public.item_outcomes o
      join public.quote_items i on i.id = o.item_id
      join public.quote_requests r on r.id = i.request_id
      join public.customers c on c.id = r.customer_id
      join public.item_quotes q on q.item_id = o.item_id and q.version = o.quote_version
      join public.item_costs k on k.item_id = o.item_id and k.version = o.quote_version
      left join public.item_sourcing s on s.item_id = i.id
      left join public.item_purchases pu on pu.item_id = i.id
      left join public.profiles pr on pr.id = pu.comprada_by
     where o.resultado = 'ganada'
       and o.quote_version = (select max(d.quote_version) from public.item_dispatch d where d.item_id = o.item_id)
       and (v_prov is null or s.proveedor ilike '%' || v_prov || '%' or k.proveedor ilike '%' || v_prov || '%')
       and (p_desde is null or o.updated_at >= p_desde)
       and (p_hasta is null or o.updated_at <= p_hasta)
       and (coalesce(p_estado, 'todas') = 'todas'
            or (p_estado = 'pendientes' and pu.comprada_at is null)
            or (p_estado = 'compradas' and pu.comprada_at is not null))
     order by (pu.comprada_at is not null), o.updated_at desc;
end $$;

-- Permisos
revoke all on function public.save_item_sourcing(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.save_item_sourcing(uuid, text, text, text, text, text) to authenticated;
revoke all on function public.get_item_sourcing(uuid) from public, anon;
grant execute on function public.get_item_sourcing(uuid) to authenticated;
revoke all on function public.mark_item_purchased(uuid, boolean) from public, anon;
grant execute on function public.mark_item_purchased(uuid, boolean) to authenticated;
revoke all on function public.por_comprar(text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.por_comprar(text, timestamptz, timestamptz, text) to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select to_regclass('public.item_sourcing') is not null and to_regclass('public.item_purchases') is not null
--          as tablas_creadas;                                                              -- true
--   select tablename, policyname from pg_policies
--    where tablename in ('item_sourcing', 'item_purchases');                               -- solo *_select (comprador)
--   select proname from pg_proc where proname in
--    ('save_item_sourcing', 'get_item_sourcing', 'mark_item_purchased', 'por_comprar')
--    and pronamespace = 'public'::regnamespace;                                             -- 4 filas
-- -----------------------------------------------------------------------------
