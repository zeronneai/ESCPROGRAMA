-- =============================================================================
-- 0036_folio_factura_unico.sql   (requiere 0035 ya aplicado)
-- Que cambia en Entregas:
--   * Una factura (folio) solo se puede subir UNA vez. Se compara sin guiones, espacios ni
--     mayusculas: F11318, F-11318 y f 11318 cuentan como el mismo folio.
--   * Al leer el PDF el portal avisa de inmediato si ese folio ya se subio, quien y cuando,
--     antes de mandar nada. Si la entrega anterior se cancelo, si se puede volver a subir.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

create or replace function public.folio_norm(p text) returns text
language sql immutable as $$ select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g') $$;

drop index if exists public.salidas_folio_uq;
create unique index salidas_folio_uq on public.salidas (public.folio_norm(folio_factura)) where estado <> 'cancelada';

-- Si el folio ya se uso: folio, cuando, quien lo subio y en que va. Null si esta libre.
create or replace function public.salida_folio_usado(p_folio text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.salidas;
begin
  if not (public.puede_subir_factura() or public.is_almacen()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if public.folio_norm(p_folio) = '' then return null; end if;
  select * into s from public.salidas
   where public.folio_norm(folio_factura) = public.folio_norm(p_folio) and estado <> 'cancelada'
   order by created_at desc limit 1;
  if s.id is null then return null; end if;
  return jsonb_build_object(
    'id', s.id, 'folio', s.folio_factura, 'subio', s.autor_nombre, 'cliente', s.cliente,
    'fecha', to_char(s.created_at at time zone coalesce((select timezone from public.app_settings limit 1), 'America/Chihuahua'), 'DD/MM/YYYY HH24:MI'),
    'estado', s.estado,
    'estado_txt', case s.estado when 'por_cargar' then 'por cargar' when 'cargando' then 'cargandose' when 'cargada' then 'ya se cargo' else s.estado end,
    'puede_ver', public.puede_ver_salida(s.created_by));
end $$;
grant execute on function public.salida_folio_usado(text) to authenticated;

create or replace function public.salida_crear(p_folio text, p_fecha date, p_cliente text, p_vendedor text, p_notas text,
                                               p_factura_path text, p_factura_nombre text, p_xml_path text, p_lineas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_usado jsonb; v_id uuid; l jsonb; i integer := 0; v_art uuid; v_clave text; v_cant integer;
begin
  if not public.puede_subir_factura() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if coalesce(trim(p_folio), '') = '' then raise exception 'Falta el folio de la factura'; end if;
  v_usado := public.salida_folio_usado(p_folio);
  if v_usado is not null then
    raise exception '%', 'La factura ' || (v_usado ->> 'folio') || ' ya se subio el ' || (v_usado ->> 'fecha') || ' por ' || coalesce(v_usado ->> 'subio', '?')
      || ' (' || (v_usado ->> 'estado_txt') || '). No se puede subir dos veces.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La factura no tiene articulos'; end if;
  insert into public.salidas (folio_factura, fecha_factura, cliente, vendedor_factura, notas, factura_path, factura_nombre, xml_path)
  values (upper(trim(p_folio)), p_fecha, nullif(left(trim(coalesce(p_cliente, '')), 300), ''), nullif(left(trim(coalesce(p_vendedor, '')), 150), ''),
          nullif(left(trim(coalesce(p_notas, '')), 1000), ''), p_factura_path, left(p_factura_nombre, 200), p_xml_path)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    i := i + 1;
    v_clave := nullif(upper(trim(coalesce(l ->> 'clave', ''))), '');
    v_cant := ceil((l ->> 'cantidad')::numeric)::integer;
    if v_cant is null or v_cant < 1 then raise exception 'Cantidad invalida en la partida %', i; end if;
    select id into v_art from public.articulos where upper(clave) = v_clave;
    insert into public.salida_lineas (salida_id, orden, articulo_id, clave, descripcion, unidad, cantidad)
    values (v_id, i, v_art, v_clave, left(l ->> 'descripcion', 500), left(l ->> 'unidad', 60), v_cant);
  end loop;
  perform public.notify_role('almacen', 'salida_nueva', 'Factura por cargar: ' || upper(trim(p_folio)),
    coalesce(left(p_cliente, 120), '') , '/entregas/' || v_id, v_id);
  perform public.notify_role('supervisor_almacen', 'salida_nueva', 'Factura por cargar: ' || upper(trim(p_folio)),
    coalesce(left(p_cliente, 120), ''), '/entregas/' || v_id, v_id);
  return v_id;
end $$;

commit;
