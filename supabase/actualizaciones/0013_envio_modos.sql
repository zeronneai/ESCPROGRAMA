-- =============================================================================
-- 0013_envio_modos.sql
-- Que hace: el envio al cliente va DENTRO del precio unitario (el PDF ya no lo muestra como renglon).
--   * quote_pdf_data: modos incluido (sin envio), por_unidad, por_pedido y por_partida. Lo guardado con
--     envio aparte pasa a por_pedido (mismo monto y moneda).
--   * quote_pdf_shipping_items: montos por partida (por unidad o total de la partida).
--   * company_profile.leyenda_envio: leyenda del pie sobre el envio, editable en Configuracion.
--   * save_pdf_envio(): guarda datos del PDF, modo, monto, moneda y partidas. save_pdf_data() se conserva.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0011_pdf_y_cliente.sql.
-- =============================================================================

-- 1) quote_pdf_data: nuevos modos
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.quote_pdf_data'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%envio_modo%'
  loop
    execute format('alter table public.quote_pdf_data drop constraint %I', c.conname);
  end loop;
end $$;

-- Las filas guardadas con envio aparte pasan a "por todo el pedido" (mismo monto y moneda).
-- La conversion queda en la bitacora (valor anterior y nuevo) por el trigger de auditoria.
update public.quote_pdf_data set envio_modo = 'por_pedido' where envio_modo = 'aparte';

alter table public.quote_pdf_data
  add constraint quote_pdf_data_envio_modo_check
    check (envio_modo in ('incluido', 'por_unidad', 'por_pedido', 'por_partida')),
  add constraint quote_pdf_data_envio_datos_check
    check (
      envio_modo = 'incluido'
      or (envio_moneda is not null and (envio_modo = 'por_partida' or (envio_monto is not null and envio_monto > 0)))
    );

-- 2) Montos por partida (modo por_partida)
create table public.quote_pdf_shipping_items (
  request_id uuid not null,
  revision smallint not null,
  item_id uuid not null references public.quote_items (id),
  monto numeric(14, 2) not null check (monto > 0),
  tipo text not null check (tipo in ('unidad', 'total')),
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (request_id, revision, item_id),
  foreign key (request_id, revision) references public.quote_pdf_data (request_id, revision)
);
create trigger quote_pdf_shipping_items_audit after insert or update or delete on public.quote_pdf_shipping_items
  for each row execute function public.audit_row();
alter table public.quote_pdf_shipping_items enable row level security;
revoke all on public.quote_pdf_shipping_items from anon, authenticated;
grant select on public.quote_pdf_shipping_items to authenticated;
create policy pdf_ship_items_select on public.quote_pdf_shipping_items for select to authenticated
  using (public.can_read_request(request_id));

-- 3) Leyenda de envio del pie, editable en Configuracion
alter table public.company_profile
  add column leyenda_envio text not null default 'Prices include shipping charges to your plant in {destino}, via {via}';
grant update (leyenda_envio) on public.company_profile to authenticated;

-- 4) Funcion nueva: guarda datos del PDF + modo de envio + montos por partida
create or replace function public.save_pdf_envio(
  p_request uuid, p_destino text, p_via text, p_condiciones text, p_atencion text,
  p_modo text, p_monto numeric, p_moneda public.currency, p_items jsonb
) returns smallint
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; v_rev smallint; e jsonb; v_item uuid; v_n integer := 0;
begin
  select * into r from public.quote_requests where id = p_request;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if r.estado <> 'enviada' then raise exception 'La solicitud no esta enviada'; end if;
  if p_modo not in ('incluido', 'por_unidad', 'por_pedido', 'por_partida') then
    raise exception 'Modo de envio invalido';
  end if;
  if p_modo in ('por_unidad', 'por_pedido') and (p_monto is null or p_monto <= 0 or p_moneda is null) then
    raise exception 'Captura el monto y la moneda del envio';
  end if;
  if p_modo = 'por_partida' then
    if p_moneda is null then raise exception 'Captura el monto y la moneda del envio'; end if;
    if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
      raise exception 'Captura el monto de envio de al menos una partida';
    end if;
    for e in select * from jsonb_array_elements(p_items) loop
      v_item := (e ->> 'item_id')::uuid;
      if not exists (select 1 from public.quote_items where id = v_item and request_id = p_request) then
        raise exception 'La partida no pertenece a la solicitud';
      end if;
      if coalesce((e ->> 'monto')::numeric, 0) <= 0 then raise exception 'El monto de envio debe ser mayor a cero'; end if;
      if (e ->> 'tipo') not in ('unidad', 'total') then raise exception 'Elige si el monto es por unidad o total de la partida'; end if;
    end loop;
  end if;

  select coalesce(max(q.version), 1) into v_rev
    from public.item_quotes q join public.quote_items i on i.id = q.item_id where i.request_id = p_request;

  insert into public.quote_pdf_data (request_id, revision, destino_entrega, via_envio, condiciones, atencion,
                                     envio_modo, envio_monto, envio_moneda, updated_by)
  values (p_request, v_rev, nullif(trim(coalesce(p_destino, '')), ''), nullif(trim(coalesce(p_via, '')), ''),
          coalesce(nullif(trim(coalesce(p_condiciones, '')), ''), 'Credito'), nullif(trim(coalesce(p_atencion, '')), ''),
          p_modo,
          case when p_modo in ('por_unidad', 'por_pedido') then p_monto end,
          case when p_modo <> 'incluido' then p_moneda end,
          auth.uid())
  on conflict (request_id, revision) do update set
    destino_entrega = excluded.destino_entrega, via_envio = excluded.via_envio, condiciones = excluded.condiciones,
    atencion = excluded.atencion, envio_modo = excluded.envio_modo, envio_monto = excluded.envio_monto,
    envio_moneda = excluded.envio_moneda, updated_by = excluded.updated_by, updated_at = now();

  delete from public.quote_pdf_shipping_items where request_id = p_request and revision = v_rev;
  if p_modo = 'por_partida' then
    insert into public.quote_pdf_shipping_items (request_id, revision, item_id, monto, tipo, updated_by)
    select p_request, v_rev, (x ->> 'item_id')::uuid, (x ->> 'monto')::numeric, x ->> 'tipo', auth.uid()
      from jsonb_array_elements(p_items) x;
  end if;
  return v_rev;
end $$;

-- 5) Funcion anterior (misma firma): se conserva por compatibilidad; 'aparte' equivale a 'por_pedido'
create or replace function public.save_pdf_data(
  p_request uuid, p_destino text, p_via text, p_condiciones text, p_atencion text,
  p_modo text, p_monto numeric, p_moneda public.currency
) returns smallint
language plpgsql security definer set search_path = public as $$
begin
  if p_modo not in ('incluido', 'aparte') then raise exception 'Modo de envio invalido'; end if;
  if p_modo = 'aparte' and (p_monto is null or p_monto <= 0 or p_moneda is null) then
    raise exception 'Captura el monto y la moneda del envio';
  end if;
  return public.save_pdf_envio(p_request, p_destino, p_via, p_condiciones, p_atencion,
                               case when p_modo = 'aparte' then 'por_pedido' else 'incluido' end,
                               p_monto, p_moneda, null);
end $$;

revoke all on function public.save_pdf_envio(uuid, text, text, text, text, text, numeric, public.currency, jsonb) from public, anon;
grant execute on function public.save_pdf_envio(uuid, text, text, text, text, text, numeric, public.currency, jsonb) to authenticated;
revoke all on function public.save_pdf_data(uuid, text, text, text, text, text, numeric, public.currency) from public, anon;
grant execute on function public.save_pdf_data(uuid, text, text, text, text, text, numeric, public.currency) to authenticated;

-- Verificacion (ejecutar aparte):
--   select conname from pg_constraint where conrelid = 'public.quote_pdf_data'::regclass and contype = 'c';   -- incluye quote_pdf_data_envio_modo_check
--   select count(*) from public.quote_pdf_data where envio_modo = 'aparte';                                  -- 0
--   select to_regclass('public.quote_pdf_shipping_items');                                                   -- quote_pdf_shipping_items
--   select leyenda_envio from public.company_profile;                                                        -- plantilla con {destino} y {via}
--   select proname from pg_proc where proname in ('save_pdf_envio', 'save_pdf_data');                        -- 2 filas
