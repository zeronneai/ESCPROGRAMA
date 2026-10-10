-- =============================================================================
-- 0015_compra_minima.sql
-- Que hace: la compra minima es OBLIGATORIA en toda cotizacion nueva (cantidad >= 1 y unidad; 1 = sin minimo real).
--   * respond_item(): valida compra_min en "quote" y en "update_cost" (si manda compra_min). "confirm" hereda.
--     El monto minimo sigue siendo opcional como condicion adicional. No se modifica ninguna cotizacion
--     ya bloqueada: las que no tienen cantidad se asumen con minimo 1 al mostrarlas.
--   * item_quotes: check compra_min_cantidad >= 1 solo para filas nuevas (NOT VALID, no revisa las anteriores).
--   * quote_pdf_min_choices: decision del vendedor por partida y revision cuando la cantidad pedida es menor
--     al minimo: 'cotizar_minimo' o 'mantener_pedida' (con bitacora).
--   * save_pdf_minimos(): guarda esas decisiones (solo el vendedor dueno de la solicitud enviada).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0014_alternativo_nombre_pdf.sql (y las anteriores).
-- =============================================================================

begin;

alter table public.item_quotes
  add constraint item_quotes_compra_min_cantidad_ge1_check
  check (compra_min_cantidad is null or compra_min_cantidad >= 1) not valid;

create table public.quote_pdf_min_choices (
  request_id uuid not null references public.quote_requests (id),
  revision smallint not null check (revision >= 1),
  item_id uuid not null references public.quote_items (id),
  decision text not null check (decision in ('cotizar_minimo', 'mantener_pedida')),
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (request_id, revision, item_id)
);
create trigger quote_pdf_min_choices_audit after insert or update on public.quote_pdf_min_choices
  for each row execute function public.audit_row();
create trigger quote_pdf_min_choices_no_delete before delete on public.quote_pdf_min_choices
  for each row execute function public.forbid_mutation();
alter table public.quote_pdf_min_choices enable row level security;
revoke all on public.quote_pdf_min_choices from anon, authenticated;
grant select on public.quote_pdf_min_choices to authenticated;
create policy pdf_min_choices_select on public.quote_pdf_min_choices for select to authenticated
  using (public.can_read_request(request_id));

create or replace function public.save_pdf_minimos(p_request uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; e jsonb; v_item uuid; v_dec text; v_rev smallint; v_n integer := 0;
begin
  select * into r from public.quote_requests where id = p_request;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then raise exception 'Decisiones invalidas'; end if;
  select coalesce(max(q.version), 1) into v_rev
    from public.item_quotes q join public.quote_items i on i.id = q.item_id where i.request_id = p_request;
  for e in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (e ->> 'item_id')::uuid;
    v_dec := e ->> 'decision';
    if not exists (select 1 from public.quote_items where id = v_item and request_id = p_request) then
      raise exception 'La partida no pertenece a la solicitud';
    end if;
    if v_dec is null or v_dec not in ('cotizar_minimo', 'mantener_pedida') then
      raise exception 'Elige cotizar a la cantidad minima o mantener la cantidad pedida';
    end if;
    insert into public.quote_pdf_min_choices (request_id, revision, item_id, decision, updated_by)
    values (p_request, v_rev, v_item, v_dec, auth.uid())
    on conflict (request_id, revision, item_id) do update
      set decision = excluded.decision, updated_by = excluded.updated_by, updated_at = now()
      where public.quote_pdf_min_choices.decision is distinct from excluded.decision;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- respond_item con compra minima obligatoria (el resto es igual a la version de 0014)
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
  v_min jsonb := p_payload -> 'compra_min';
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  v_prev := i.estado;

  -- Compra minima OBLIGATORIA en toda cotizacion nueva: cantidad (>= 1) y unidad. 1 = se puede comprar desde 1 pieza.
  if p_action = 'quote' or (p_action = 'update_cost' and p_payload ? 'compra_min') then
    if jsonb_typeof(v_min) is distinct from 'object'
       or coalesce((v_min ->> 'cantidad')::numeric, 0) < 1
       or nullif(trim(coalesce(v_min ->> 'unidad', '')), '') is null then
      raise exception 'La compra minima es obligatoria: cantidad (minimo 1) y unidad. Si no hay minimo, captura 1';
    end if;
  end if;

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

revoke all on function public.respond_item(uuid, text, jsonb) from public, anon;
grant execute on function public.respond_item(uuid, text, jsonb) to authenticated;
revoke all on function public.save_pdf_minimos(uuid, jsonb) from public, anon;
grant execute on function public.save_pdf_minimos(uuid, jsonb) to authenticated;

commit;

-- Verificacion (ejecutar aparte):
--   select to_regclass('public.quote_pdf_min_choices');                                                     -- quote_pdf_min_choices
--   select proname from pg_proc where proname in ('save_pdf_minimos', 'respond_item');                      -- 2 filas
--   select conname, convalidated from pg_constraint where conname = 'item_quotes_compra_min_cantidad_ge1_check';  -- convalidated = false (no revisa filas anteriores)
--   select count(*) from public.item_quotes where compra_min_cantidad is null;                              -- cotizaciones anteriores sin cantidad: se asumen con minimo 1
