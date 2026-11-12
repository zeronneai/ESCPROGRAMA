-- =============================================================================
-- 0052_cotizaciones_foto_guias_palomeo.sql
-- 1) Solicitud de cotizacion: la imagen o link de referencia ya NO es obligatoria.
-- 2) Imagen de confirmacion del comprador por partida: el comprador la sube como confirmacion del
--    producto y el vendedor la descarga para mandarla aparte (no va en el PDF).
-- 3) Guias: Marketplaces palomea cada partida conforme la va armando. Si el vendedor cambia las
--    partidas, se borran las palomitas.
-- Se puede correr en cualquier momento (despues de 0049).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

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
      -- La imagen o link de referencia ya es opcional.
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

-- Imagen de confirmacion del comprador (bucket privado "aclaraciones", carpeta {solicitud}/{partida}/).
alter table public.quote_items
  add column foto_compra_path text,
  add column foto_compra_nombre text check (foto_compra_nombre is null or length(foto_compra_nombre) <= 200),
  add column foto_compra_at timestamptz;

create or replace function public.item_foto_compra(p_item uuid, p_path text, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_req uuid;
begin
  if not public.is_buyer() then raise exception 'Solo el comprador sube la imagen de confirmacion' using errcode = '42501'; end if;
  select request_id into v_req from public.quote_items where id = p_item;
  if v_req is null then raise exception 'Partida no encontrada'; end if;
  if p_path is not null and p_path not like v_req::text || '/' || p_item::text || '/%' then raise exception 'Archivo invalido'; end if;
  update public.quote_items
     set foto_compra_path = p_path,
         foto_compra_nombre = case when p_path is null then null else left(coalesce(nullif(trim(p_nombre), ''), 'imagen'), 200) end,
         foto_compra_at = case when p_path is null then null else now() end
   where id = p_item;
end $$;
revoke all on function public.item_foto_compra(uuid, text, text) from public, anon;
grant execute on function public.item_foto_compra(uuid, text, text) to authenticated;

-- Palomeo de partidas de la guia (indices de las partidas ya armadas).
alter table public.guias add column partidas_listas jsonb not null default '[]'::jsonb
  check (jsonb_typeof(partidas_listas) = 'array' and jsonb_array_length(partidas_listas) <= 30);

create or replace function public.guia_palomear(p_id uuid, p_idx integer, p_lista boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_marketplaces() then raise exception 'Solo Marketplaces palomea las partidas' using errcode = '42501'; end if;
  if p_idx is null or p_idx < 0 or p_idx >= 30 then raise exception 'Partida invalida'; end if;
  select partidas_listas into v from public.guias where id = p_id for update;
  if v is null then raise exception 'Guia no encontrada'; end if;
  v := coalesce((select jsonb_agg(x order by x) from (
         select e::integer as x from jsonb_array_elements_text(v) e where e::integer <> p_idx
         union select p_idx where p_lista) s), '[]'::jsonb);
  update public.guias set partidas_listas = v where id = p_id;
  return v;
end $$;
revoke all on function public.guia_palomear(uuid, integer, boolean) from public, anon;
grant execute on function public.guia_palomear(uuid, integer, boolean) to authenticated;

-- Si cambian las partidas, se borran las palomitas.
create or replace function public.guias_partidas_reset() returns trigger
language plpgsql as $$
begin
  if new.partidas is distinct from old.partidas then new.partidas_listas := '[]'::jsonb; end if;
  return new;
end $$;
create trigger guias_partidas_reset before update of partidas on public.guias
  for each row execute function public.guias_partidas_reset();

commit;
