-- =============================================================================
-- 0014_alternativo_nombre_pdf.sql
-- Que hace: la descripcion y el uso del producto son INTERNOS; al cliente solo llega un nombre.
--   * item_quotes: producto alternativo sugerido por el comprador (alt_nombre, alt_descripcion, alt_motivo).
--     Forma parte de la version cotizada: queda bloqueado igual que el costo y se conserva por version.
--     El proveedor y el link de compra siguen en item_sourcing (solo comprador).
--   * item_pdf_names: "Nombre en el PDF" por partida y version (lo edita el vendedor, con bitacora).
--     Sin fila, el PDF usa el nombre del producto (o el del alternativo si el comprador lo cotizo).
--   * respond_item(): acepta la clave opcional "alternativo" {nombre, descripcion, motivo}.
--   * save_pdf_names(): guarda los nombres del PDF (solo el vendedor dueno de la solicitud enviada).
--   * similar_quotes() y product_cost_history(): tambien buscan en la descripcion/uso (pg_trgm) y en el
--     alternativo; similar_quotes devuelve ademas descripcion y alternativo.
--   * Indices pg_trgm para quote_items.descripcion e item_quotes.alt_nombre.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0013_envio_modos.sql (y las anteriores).
-- =============================================================================

begin;

-- 1) Producto alternativo dentro de la version cotizada
alter table public.item_quotes
  add column alt_nombre text,
  add column alt_descripcion text,
  add column alt_motivo text,
  add constraint item_quotes_alt_check check (
    (alt_nombre is null and alt_motivo is null and alt_descripcion is null)
    or (length(trim(alt_nombre)) between 1 and 200
        and length(trim(alt_motivo)) between 1 and 1000
        and (alt_descripcion is null or length(alt_descripcion) <= 500))
  );

create index if not exists quote_items_descripcion_trgm_idx
  on public.quote_items using gin (descripcion extensions.gin_trgm_ops);
create index if not exists item_quotes_alt_nombre_trgm_idx
  on public.item_quotes using gin (alt_nombre extensions.gin_trgm_ops);

-- 2) Nombre en el PDF por partida y version
create table public.item_pdf_names (
  item_id uuid not null,
  quote_version smallint not null,
  nombre text check (nombre is null or length(trim(nombre)) between 1 and 200),  -- null = usar el nombre por defecto
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (item_id, quote_version),
  foreign key (item_id, quote_version) references public.item_quotes (item_id, version)
);
create trigger item_pdf_names_audit after insert or update on public.item_pdf_names
  for each row execute function public.audit_row();
create trigger item_pdf_names_no_delete before delete on public.item_pdf_names
  for each row execute function public.forbid_mutation();
alter table public.item_pdf_names enable row level security;
revoke all on public.item_pdf_names from anon, authenticated;
grant select on public.item_pdf_names to authenticated;
create policy item_pdf_names_select on public.item_pdf_names for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

create or replace function public.save_pdf_names(p_request uuid, p_names jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; e jsonb; v_item uuid; v_nombre text; v_ver smallint; v_n integer := 0;
begin
  select * into r from public.quote_requests where id = p_request;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if jsonb_typeof(coalesce(p_names, '[]'::jsonb)) <> 'array' then raise exception 'Nombres invalidos'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_names, '[]'::jsonb)) loop
    v_item := (e ->> 'item_id')::uuid;
    v_nombre := nullif(trim(coalesce(e ->> 'nombre', '')), '');
    if not exists (select 1 from public.quote_items where id = v_item and request_id = p_request) then
      raise exception 'La partida no pertenece a la solicitud';
    end if;
    if v_nombre is not null and length(v_nombre) > 200 then
      raise exception 'El nombre en el PDF no puede pasar de 200 caracteres';
    end if;
    select max(version) into v_ver from public.item_quotes where item_id = v_item;
    if v_ver is null then continue; end if;   -- partida sin cotizar: no aparece en el PDF
    if v_nombre is null and not exists (select 1 from public.item_pdf_names where item_id = v_item and quote_version = v_ver) then
      continue;
    end if;
    insert into public.item_pdf_names (item_id, quote_version, nombre, updated_by)
    values (v_item, v_ver, v_nombre, auth.uid())
    on conflict (item_id, quote_version) do update
      set nombre = excluded.nombre, updated_by = excluded.updated_by, updated_at = now()
      where public.item_pdf_names.nombre is distinct from excluded.nombre;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 3) respond_item con producto alternativo (claves: quote y update_cost aceptan "alternativo"; confirm lo hereda)
-- Claves de 'quote' y 'update_cost': agregan "alternativo" {nombre, descripcion, motivo} (opcional; en update_cost, si la clave falta se hereda).
create or replace function public.respond_item(p_item uuid, p_action text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  i public.quote_items; r public.quote_requests; u public.item_update_requests;
  prevc public.item_costs; prevq public.item_quotes;
  v_prev public.item_status; v_version smallint;
  v_hours numeric := nullif(p_payload ->> 'response_hours', '')::numeric;
  v_nota text := nullif(trim(coalesce(p_payload ->> 'nota', '')), '');
  v_alt jsonb := p_payload -> 'alternativo';
  v_an text; v_ad text; v_am text;
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  v_prev := i.estado;

  -- Producto alternativo (opcional): nombre y motivo obligatorios; forma parte de la version cotizada.
  if p_action in ('quote', 'update_cost') and jsonb_typeof(v_alt) = 'object' then
    v_an := nullif(trim(coalesce(v_alt ->> 'nombre', '')), '');
    v_ad := nullif(trim(coalesce(v_alt ->> 'descripcion', '')), '');
    v_am := nullif(trim(coalesce(v_alt ->> 'motivo', '')), '');
    if v_an is null then raise exception 'El nombre del producto alternativo es obligatorio'; end if;
    if v_am is null then raise exception 'Explica por que el producto alternativo sirve para lo mismo'; end if;
    if length(v_an) > 200 then raise exception 'El nombre del alternativo no puede pasar de 200 caracteres'; end if;
  end if;

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
      compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by,
      alt_nombre, alt_descripcion, alt_motivo)
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
      v_nota, auth.uid(), v_an, v_ad, v_am);
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

  elsif p_action in ('confirm', 'update_cost') then
    if i.estado <> 'actualizacion_solicitada' then
      raise exception 'La partida no tiene una actualizacion solicitada';
    end if;
    select * into u from public.item_update_requests where item_id = p_item and resolved_at is null;
    if not found then raise exception 'No hay una solicitud de actualizacion abierta'; end if;
    select * into prevq from public.item_quotes where item_id = p_item order by version desc limit 1;
    select * into prevc from public.item_costs where item_id = p_item and version = prevq.version;
    v_version := prevq.version + 1;

    if p_action = 'confirm' then
      -- Mismos costos, factores, precios y condiciones; solo cambian la version y la vigencia.
      insert into public.item_costs (item_id, version, costo, envio, base, proveedor, factors_snapshot, created_by)
      values (p_item, v_version, prevc.costo, prevc.envio, 0, prevc.proveedor, prevc.factors_snapshot, auth.uid());
      insert into public.item_quotes (
        item_id, version, moneda, price_1, price_2, price_3, price_4, price_5, entrega_dias, entrega_tipo, entrega_fecha,
        compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by,
        alt_nombre, alt_descripcion, alt_motivo)
      values (p_item, v_version, prevq.moneda, prevq.price_1, prevq.price_2, prevq.price_3, prevq.price_4, prevq.price_5,
        prevq.entrega_dias, prevq.entrega_tipo, prevq.entrega_fecha,
        prevq.compra_min_cantidad, prevq.compra_min_unidad, prevq.compra_min_monto,
        coalesce(v_nota, prevq.nota), auth.uid(), prevq.alt_nombre, prevq.alt_descripcion, prevq.alt_motivo);
    else
      insert into public.item_costs (item_id, version, costo, envio, base, proveedor, factors_snapshot, created_by)
      values (p_item, v_version, (p_payload ->> 'costo')::numeric, nullif((p_payload ->> 'envio')::numeric, 0), 0,
              coalesce(nullif(trim(coalesce(p_payload ->> 'proveedor', '')), ''), prevc.proveedor),
              p_payload -> 'factors', auth.uid());
      insert into public.item_quotes (
        item_id, version, moneda, price_1, price_2, price_3, price_4, price_5, entrega_dias, entrega_tipo, entrega_fecha,
        compra_min_cantidad, compra_min_unidad, compra_min_monto, nota, quoted_by,
        alt_nombre, alt_descripcion, alt_motivo)
      values (p_item, v_version, coalesce((p_payload ->> 'moneda')::public.currency, prevq.moneda),
        (p_payload #>> '{prices,p1}')::numeric, (p_payload #>> '{prices,p2}')::numeric,
        (p_payload #>> '{prices,p3}')::numeric, (p_payload #>> '{prices,p4}')::numeric,
        (p_payload #>> '{prices,p5}')::numeric,
        case when p_payload ? 'entrega' then (p_payload #>> '{entrega,dias}')::integer else prevq.entrega_dias end,
        case when p_payload ? 'entrega' then (p_payload #>> '{entrega,tipo}')::public.delivery_kind else prevq.entrega_tipo end,
        case when p_payload ? 'entrega' then (p_payload #>> '{entrega,fecha}')::date else prevq.entrega_fecha end,
        case when p_payload ? 'compra_min' then (p_payload #>> '{compra_min,cantidad}')::numeric else prevq.compra_min_cantidad end,
        case when p_payload ? 'compra_min' then nullif(trim(coalesce(p_payload #>> '{compra_min,unidad}', '')), '') else prevq.compra_min_unidad end,
        case when p_payload ? 'compra_min' then (p_payload #>> '{compra_min,monto}')::numeric else prevq.compra_min_monto end,
        coalesce(v_nota, prevq.nota), auth.uid(),
        case when p_payload ? 'alternativo' then v_an else prevq.alt_nombre end,
        case when p_payload ? 'alternativo' then v_ad else prevq.alt_descripcion end,
        case when p_payload ? 'alternativo' then v_am else prevq.alt_motivo end);
    end if;

    update public.quote_items set estado = 'cotizada' where id = p_item;
    update public.item_update_requests
       set resolved_at = now(), resolved_by = auth.uid(), resolved_version = v_version,
           resolution = case when p_action = 'confirm' then 'sin_cambios' else 'actualizado' end,
           response_business_hours = v_hours
     where id = u.id;
    perform public.notify_user(r.vendedor_id, 'actualizacion_lista', 'Actualizacion lista ' || i.folio,
      i.producto || ': nueva version ' || v_version || '. Elige el precio y marca Enviado otra vez.',
      '/vendedor/solicitudes/' || r.id, null);
    return jsonb_build_object('estado', 'cotizada', 'version', v_version);
  end if;
  raise exception 'Accion invalida: %', p_action;
end $$;

-- 4) Busquedas: tambien en la descripcion/uso y en el alternativo
drop function public.similar_quotes(text, text, uuid, integer);
create function public.similar_quotes(
  p_name text default null, p_proveedor text default null, p_exclude_item uuid default null, p_limit integer default 15
) returns table (
  item_id uuid, version smallint, folio text, producto text, cliente text, quoted_at timestamptz,
  costo numeric, envio numeric, moneda public.currency, proveedor text,
  precio_elegido smallint, valor_elegido numeric, resultado public.outcome_result, similitud real,
  descripcion text, alt_nombre text, alt_descripcion text
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
           case when v_name is null then 1::real
                else greatest(similarity(i.producto, v_name),
                              word_similarity(v_name, i.descripcion) * 0.9::real,
                              coalesce(similarity(q.alt_nombre, v_name), 0::real)) end,
           i.descripcion, q.alt_nombre, q.alt_descripcion
      from public.item_costs k
      join public.item_quotes q on q.item_id = k.item_id and q.version = k.version
      join public.quote_items i on i.id = k.item_id
      join public.quote_requests r on r.id = i.request_id
      join public.customers c on c.id = r.customer_id
      left join public.item_dispatch d on d.item_id = k.item_id and d.quote_version = k.version
      left join public.item_outcomes o on o.item_id = k.item_id and o.quote_version = k.version
     where (p_exclude_item is null or i.id <> p_exclude_item)
       and (v_name is null
            or similarity(i.producto, v_name) >= 0.3 or i.producto ilike '%' || v_name || '%'
            or word_similarity(v_name, i.descripcion) >= 0.5 or i.descripcion ilike '%' || v_name || '%'
            or similarity(q.alt_nombre, v_name) >= 0.3 or q.alt_nombre ilike '%' || v_name || '%')
       and (v_prov is null or k.proveedor ilike '%' || v_prov || '%')
     order by 14 desc, q.quoted_at desc
     limit greatest(1, least(coalesce(p_limit, 15), 100));
end $$;

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
        or i.descripcion ilike '%' || v_name || '%'
        or q.alt_nombre ilike '%' || v_name || '%'
     order by q.quoted_at
     limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

-- Permisos (se reaplican de forma explicita en las funciones reemplazadas o nuevas)
revoke all on function public.respond_item(uuid, text, jsonb) from public, anon;
grant execute on function public.respond_item(uuid, text, jsonb) to authenticated;
revoke all on function public.save_pdf_names(uuid, jsonb) from public, anon;
grant execute on function public.save_pdf_names(uuid, jsonb) to authenticated;
revoke all on function public.similar_quotes(text, text, uuid, integer) from public, anon;
grant execute on function public.similar_quotes(text, text, uuid, integer) to authenticated;
revoke all on function public.product_cost_history(text, integer) from public, anon;
grant execute on function public.product_cost_history(text, integer) to authenticated;

commit;

-- Verificacion (ejecutar aparte):
--   select column_name from information_schema.columns where table_name = 'item_quotes' and column_name like 'alt_%';   -- 3 filas
--   select to_regclass('public.item_pdf_names');                                                                         -- item_pdf_names
--   select proname from pg_proc where proname in ('save_pdf_names', 'similar_quotes', 'respond_item');                   -- 3 filas
--   select indexname from pg_indexes where indexname in ('quote_items_descripcion_trgm_idx', 'item_quotes_alt_nombre_trgm_idx');  -- 2 filas
