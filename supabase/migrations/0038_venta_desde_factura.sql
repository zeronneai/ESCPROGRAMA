-- =============================================================================
-- 0038_venta_desde_factura.sql   (requiere 0036 y 0037 ya aplicados)
-- Que cambia:
--   * VENTA CON FACTURA: el vendedor sube el PDF (o XML) de la factura y con eso se registra la venta:
--     fecha, folio, total, moneda, contado o credito (y dias), cliente y articulos. El cliente se busca por
--     RFC (o por nombre); si no existe se da de alta con razon social, RFC, direccion y telefono, y si ya
--     existe se le llenan los datos que le falten. Si la factura trae articulos del catalogo, tambien se
--     manda a almacen para cargar (una sola subida). Al terminar la carga, la venta queda como Entregada.
--   * Una factura (folio o folio fiscal) no se puede registrar dos veces.
--   * ALMACEN YA NO CIERRA CON FALTANTES: solo termina cuando esta completa. Si no hay material, la pone
--     "En espera por falta de material" con un mensaje (avisa al vendedor y a compras). No se cancela:
--     cuando llega el material se sigue escaneando. Almacen tampoco cancela entregas; las cancela quien
--     subio la factura (si aun no se empieza a cargar) o la jefa de ventas.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas
-- ---------------------------------------------------------------------------
alter table public.ventas drop constraint if exists ventas_origen_check;
alter table public.ventas add constraint ventas_origen_check check (origen in ('vendedor', 'portal', 'factura'));
alter table public.ventas
  add column factura_uuid text,
  add column factura_path text,
  add column factura_nombre text,
  add column xml_path text;
create unique index ventas_factura_uq on public.ventas (public.folio_norm(factura)) where origen = 'factura' and cancelada_at is null;
create unique index ventas_factura_uuid_uq on public.ventas (upper(factura_uuid)) where factura_uuid is not null and cancelada_at is null;

alter table public.salidas
  add column venta_id uuid references public.ventas (id),
  add column espera boolean not null default false,
  add column espera_nota text check (espera_nota is null or length(espera_nota) <= 500),
  add column espera_at timestamptz,
  add column espera_nombre text;
create index salidas_venta_idx on public.salidas (venta_id) where venta_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Folio repetido: tambien cuenta una venta registrada con esa factura
-- ---------------------------------------------------------------------------
create or replace function public.salida_folio_usado(p_folio text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.salidas; v public.ventas; v_tz text := coalesce((select timezone from public.app_settings limit 1), 'America/Chihuahua');
begin
  if not (public.puede_subir_factura() or public.is_almacen()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if public.folio_norm(p_folio) = '' then return null; end if;
  select * into s from public.salidas
   where public.folio_norm(folio_factura) = public.folio_norm(p_folio) and estado <> 'cancelada'
   order by created_at desc limit 1;
  if s.id is not null then
    return jsonb_build_object(
      'id', s.id, 'folio', s.folio_factura, 'subio', s.autor_nombre, 'cliente', s.cliente,
      'fecha', to_char(s.created_at at time zone v_tz, 'DD/MM/YYYY HH24:MI'),
      'estado', s.estado,
      'estado_txt', case s.estado when 'por_cargar' then 'por cargar' when 'cargando' then 'cargandose' when 'cargada' then 'ya se cargo' else s.estado end,
      'puede_ver', public.puede_ver_salida(s.created_by));
  end if;
  select * into v from public.ventas
   where origen = 'factura' and cancelada_at is null and public.folio_norm(factura) = public.folio_norm(p_folio)
   order by created_at desc limit 1;
  if v.id is null then return null; end if;
  return jsonb_build_object(
    'id', null, 'folio', v.factura, 'subio', (select nombre from public.profiles where id = v.vendedor_id), 'cliente', null,
    'fecha', to_char(v.created_at at time zone v_tz, 'DD/MM/YYYY HH24:MI'),
    'estado', 'venta', 'estado_txt', 'registrada como venta', 'puede_ver', false);
end $$;
grant execute on function public.salida_folio_usado(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Buscar al cliente de la factura (por RFC y si no, por nombre)
-- ---------------------------------------------------------------------------
create or replace function public.cliente_de_factura(p_rfc text, p_nombre text, p_razon text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_rfc text := nullif(upper(regexp_replace(coalesce(p_rfc, ''), '[\s.-]', '', 'g')), ''); v_id uuid;
begin
  -- RFC generico (publico en general / extranjero): no identifica al cliente.
  if v_rfc in ('XAXX010101000', 'XEXX010101000') then v_rfc := null; end if;
  if v_rfc is not null then
    select id into v_id from public.customers
     where rfc = v_rfc and activo order by (parent_id is null) desc, created_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  select id into v_id from public.customers
   where activo and parent_id is null
     and (lower(nombre) in (lower(trim(coalesce(p_nombre, ''))), lower(trim(coalesce(p_razon, ''))))
          or lower(coalesce(razon_social, '')) = lower(trim(coalesce(p_razon, ''))) and trim(coalesce(p_razon, '')) <> '')
   order by created_at limit 1;
  return v_id;
end $$;
revoke all on function public.cliente_de_factura(text, text, text) from public, anon;

-- Para la pantalla: a quien se le va a registrar (sin dar de alta nada todavia).
create or replace function public.cliente_factura_preview(p_rfc text, p_nombre text, p_razon text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid; c public.customers;
begin
  if not public.is_seller() then raise exception 'No autorizado' using errcode = '42501'; end if;
  v_id := public.cliente_de_factura(p_rfc, p_nombre, p_razon);
  if v_id is null then return null; end if;
  select * into c from public.customers where id = v_id;
  return jsonb_build_object('id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'rfc', c.rfc,
    'sucursal', (select p.nombre from public.customers p where p.id = c.parent_id));
end $$;
grant execute on function public.cliente_factura_preview(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Registrar la venta desde la factura (y mandarla a almacen si trae articulos del catalogo)
-- ---------------------------------------------------------------------------
create or replace function public.venta_desde_factura(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_folio text := upper(trim(coalesce(p ->> 'folio', '')));
  v_uuid text := nullif(upper(trim(coalesce(p ->> 'uuid', ''))), '');
  v_rfc text := nullif(upper(regexp_replace(coalesce(p ->> 'rfc', ''), '[\s.-]', '', 'g')), '');
  v_razon text := nullif(left(trim(coalesce(p ->> 'razon_social', '')), 200), '');
  v_nombre text := nullif(left(trim(coalesce(p ->> 'nombre', '')), 200), '');
  v_dir text := nullif(left(trim(coalesce(p ->> 'direccion', '')), 300), '');
  v_tel text := nullif(left(trim(coalesce(p ->> 'telefono', '')), 40), '');
  v_pago text := case when p ->> 'pago' = 'credito' then 'credito' else 'contado' end;
  v_dias integer := nullif(p ->> 'dias_credito', '')::integer;
  v_fecha date := coalesce(nullif(p ->> 'fecha', '')::date, public.local_today());
  v_lineas jsonb := coalesce(p -> 'lineas', '[]'::jsonb);
  v_usado jsonb; v_cust uuid; v_nuevo boolean := false; v_venta uuid; v_salida uuid; v_catalogo boolean; l jsonb; v_clave text;
begin
  if not public.is_seller() then raise exception 'Las ventas las registran los vendedores' using errcode = '42501'; end if;
  if v_folio = '' then raise exception 'Falta el folio de la factura'; end if;
  if jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then raise exception 'La factura no tiene articulos'; end if;
  if v_fecha > public.local_today() then raise exception 'La fecha de la factura no puede ser futura'; end if;
  v_usado := public.salida_folio_usado(v_folio);
  if v_usado is not null then
    raise exception '%', 'La factura ' || (v_usado ->> 'folio') || ' ya se subio el ' || (v_usado ->> 'fecha') || ' por '
      || coalesce(v_usado ->> 'subio', '?') || ' (' || (v_usado ->> 'estado_txt') || '). No se puede subir dos veces.';
  end if;
  if v_uuid is not null and exists (select 1 from public.ventas where upper(factura_uuid) = v_uuid and cancelada_at is null) then
    raise exception 'Esa factura (folio fiscal %) ya esta registrada', v_uuid;
  end if;
  if v_rfc is not null and not public.rfc_valido(v_rfc) then v_rfc := null; end if;
  if v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) < 7 then v_tel := null; end if;

  -- Cliente: el que eligio el vendedor, o el de la factura (RFC o nombre), o uno nuevo.
  if nullif(p ->> 'customer_id', '') is not null then
    select id into v_cust from public.customers where id = (p ->> 'customer_id')::uuid and activo;
    if v_cust is null then raise exception 'Cliente no encontrado'; end if;
  else
    v_cust := public.cliente_de_factura(v_rfc, v_nombre, v_razon);
  end if;
  if v_cust is not null then
    -- Se completan los datos que le falten (no se pisa lo que ya tiene).
    update public.customers
       set razon_social = coalesce(razon_social, v_razon),
           rfc = coalesce(rfc, case when v_rfc in ('XAXX010101000', 'XEXX010101000') then null else v_rfc end),
           direccion = coalesce(direccion, v_dir),
           contacto_telefono = coalesce(contacto_telefono, v_tel)
     where id = v_cust
       and (razon_social is null or rfc is null or direccion is null or contacto_telefono is null);
  else
    if coalesce(v_nombre, v_razon) is null then raise exception 'Falta el nombre del cliente'; end if;
    insert into public.customers (nombre, tipo, razon_social, rfc, direccion, contacto_telefono, created_by)
    values (coalesce(v_nombre, v_razon), 'cliente', v_razon,
            case when v_rfc in ('XAXX010101000', 'XEXX010101000') then null else v_rfc end, v_dir, v_tel, auth.uid())
    returning id into v_cust;
    v_nuevo := true;
  end if;

  -- Almacen: solo si hay articulos del catalogo que cargar.
  select exists (
    select 1 from jsonb_array_elements(v_lineas) x
      join public.articulos a on upper(a.clave) = upper(trim(coalesce(x ->> 'clave', '')))
  ) into v_catalogo;
  if v_catalogo then
    v_salida := public.salida_crear(v_folio, v_fecha,
      coalesce((select nombre from public.customers where id = v_cust), v_nombre, v_razon),
      nullif(p ->> 'vendedor_factura', ''), nullif(p ->> 'notas_almacen', ''),
      nullif(p ->> 'pdf_path', ''), nullif(p ->> 'pdf_nombre', ''), nullif(p ->> 'xml_path', ''), v_lineas);
  end if;

  insert into public.ventas (customer_id, fecha, factura, monto, moneda, pago, dias_credito, entregado, porcentaje_cobrado,
                             comentarios, origen, factura_uuid, factura_path, factura_nombre, xml_path, pedido)
  values (v_cust, v_fecha, v_folio, nullif(p ->> 'total', '')::numeric,
          case when p ->> 'moneda' = 'USD' then 'USD' else 'MXN' end::public.currency,
          v_pago, case when v_pago = 'credito' then case when v_dias between 1 and 365 then v_dias else 30 end end, false, 0,
          nullif(left(trim(coalesce(p ->> 'comentarios', '')), 2000), ''), 'factura', v_uuid,
          nullif(p ->> 'pdf_path', ''), left(nullif(p ->> 'pdf_nombre', ''), 200), nullif(p ->> 'xml_path', ''),
          nullif(left(trim(coalesce(p ->> 'pedido', '')), 80), ''))
  returning id into v_venta;

  for l in select * from jsonb_array_elements(v_lineas) loop
    v_clave := nullif(upper(trim(coalesce(l ->> 'clave', ''))), '');
    insert into public.venta_lineas (venta_id, articulo_id, descripcion, cantidad)
    values (v_venta, (select id from public.articulos where upper(clave) = v_clave limit 1),
            left(coalesce(nullif(trim(coalesce(l ->> 'descripcion', '')), ''), v_clave, 'Partida'), 300),
            nullif(l ->> 'cantidad', '')::numeric);
  end loop;

  if v_salida is not null then update public.salidas set venta_id = v_venta where id = v_salida; end if;
  return jsonb_build_object('venta_id', v_venta, 'salida_id', v_salida, 'customer_id', v_cust, 'cliente_nuevo', v_nuevo);
end $$;
grant execute on function public.venta_desde_factura(jsonb) to authenticated;

-- Al terminar de cargar, la venta queda como entregada.
create or replace function public.salidas_venta_entregada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cargada' and old.estado <> 'cargada' and new.venta_id is not null then
    update public.ventas set entregado = true where id = new.venta_id and not entregado and cancelada_at is null;
  end if;
  return null;
end $$;
create trigger salidas_venta_entregada after update of estado on public.salidas
  for each row execute function public.salidas_venta_entregada();
revoke all on function public.salidas_venta_entregada() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Carga: no se cierra con faltantes; "En espera por falta de material"
-- ---------------------------------------------------------------------------
create or replace function public.salida_terminar(p_salida uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas; v_faltan integer;
begin
  if not public.is_almacen() then raise exception 'Solo almacen cierra la carga' using errcode = '42501'; end if;
  select * into s from public.salidas where id = p_salida for update;
  if s.estado not in ('por_cargar', 'cargando') then raise exception 'La factura ya se cerro'; end if;
  select coalesce(sum(cantidad - escaneadas), 0) into v_faltan from public.salida_lineas where salida_id = p_salida and articulo_id is not null;
  if v_faltan > 0 then
    raise exception 'Faltan % pieza(s) por escanear. Si no hay material, ponla En espera por falta de material.', v_faltan;
  end if;
  update public.salidas
     set estado = 'cargada', incompleta = false, espera = false, cierre_nota = nullif(left(trim(coalesce(p_nota, '')), 500), ''),
         cargada_at = now(), cargada_por = auth.uid(), cargada_nombre = public.my_name()
   where id = p_salida;
  perform public.notify_user(s.created_by, 'salida_cargada', 'Factura ' || s.folio_factura || ' cargada completa',
    coalesce(s.cliente, ''), '/entregas/' || p_salida, p_salida);
end $$;
grant execute on function public.salida_terminar(uuid, text) to authenticated;

create or replace function public.salida_espera(p_salida uuid, p_activa boolean, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas; v_nota text := nullif(left(trim(coalesce(p_nota, '')), 500), '');
begin
  if not public.is_almacen() then raise exception 'Solo almacen' using errcode = '42501'; end if;
  select * into s from public.salidas where id = p_salida for update;
  if s.id is null then raise exception 'No encontrada'; end if;
  if s.estado not in ('por_cargar', 'cargando') then raise exception 'La factura ya se cerro'; end if;
  if p_activa then
    if v_nota is null then raise exception 'Escribe el mensaje (ej. no hay material de ...)'; end if;
    update public.salidas set espera = true, espera_nota = v_nota, espera_at = now(), espera_nombre = public.my_name() where id = p_salida;
    perform public.notify_user(s.created_by, 'salida_espera', 'Sin material: factura ' || s.folio_factura, v_nota, '/entregas/' || p_salida, p_salida);
    perform public.notify_role('comprador', 'salida_espera', 'Sin material para la factura ' || s.folio_factura, v_nota, '/entregas/' || p_salida, p_salida);
  else
    update public.salidas set espera = false, espera_at = null where id = p_salida;
    perform public.notify_user(s.created_by, 'salida_espera', 'Ya hay material: factura ' || s.folio_factura,
      'Almacen retomo la carga', '/entregas/' || p_salida, p_salida);
  end if;
end $$;
grant execute on function public.salida_espera(uuid, boolean, text) to authenticated;

-- Cancelar: quien subio la factura (si aun no se empieza a cargar) o la jefa de ventas. Almacen ya no cancela.
create or replace function public.salida_cancelar(p_salida uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas;
begin
  select * into s from public.salidas where id = p_salida for update;
  if s.id is null then raise exception 'No encontrada'; end if;
  if not (public.is_sales_manager() or (s.created_by = auth.uid() and s.estado = 'por_cargar')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if s.estado not in ('por_cargar', 'cargando') then raise exception 'La factura ya se cerro'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo'; end if;
  update public.etiquetas set estado = 'almacen', salida_id = null, salida_at = null, salida_por = null where salida_id = p_salida and estado = 'cargada';
  update public.salida_lineas set escaneadas = 0 where salida_id = p_salida;
  update public.salidas set estado = 'cancelada', espera = false, cancelada_at = now(), cierre_nota = left(trim(p_motivo), 500) where id = p_salida;
  perform public.notify_role('almacen', 'salida_cancelada', 'Entrega cancelada: factura ' || s.folio_factura, left(trim(p_motivo), 200), '/entregas/' || p_salida, p_salida);
end $$;
grant execute on function public.salida_cancelar(uuid, text) to authenticated;

commit;
