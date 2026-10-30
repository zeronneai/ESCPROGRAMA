-- =============================================================================
-- Datos de demostracion (OPCIONAL, para probar el portal con informacion)
-- =============================================================================
-- Requisitos: ya tener al menos 1 comprador y 1 vendedor activos (los vendedores
-- se crean en el portal: Comprador > Usuarios). Si hay varios vendedores, se reparten
-- las solicitudes entre ellos (hasta 3).
-- Crea 8 clientes y 15 solicitudes en distintos estados y tiempos (pendientes recientes,
-- vencidas, cotizadas sin enviar, enviadas al cliente, no encontradas, recotizada y borrador).
-- Pegalo completo en SQL Editor y presiona Run. Ejecutalo UNA sola vez.
-- Es solo para pruebas: no lo uses en el ambiente de trabajo real.
-- =============================================================================

create or replace function pg_temp.demo_quote(p_item uuid, p_costo numeric, p_envio numeric, p_buyer uuid)
returns void language plpgsql as $$
declare c public.pricing_config; v_base numeric;
begin
  perform set_config('request.jwt.claim.sub', p_buyer::text, true);
  select * into c from public.pricing_config order by id desc limit 1;
  v_base := case when coalesce(p_envio, 0) > 0 then p_costo + p_envio else p_costo * (1 + c.no_shipping_markup) end;
  perform public.respond_item(p_item, 'quote', jsonb_build_object(
    'costo', p_costo, 'envio', p_envio, 'moneda', case when p_costo > 900 then 'USD' else 'MXN' end,
    'factors', jsonb_build_object('no_shipping_markup', c.no_shipping_markup, 'p1', c.p1, 'p2', c.p2, 'p3', c.p3, 'p4', c.p4, 'p5', c.p5),
    'prices', jsonb_build_object('p1', round(v_base * c.p1, 2), 'p2', round(v_base * c.p2, 2), 'p3', round(v_base * c.p3, 2),
                                 'p4', round(v_base * c.p4, 2), 'p5', round(v_base * c.p5, 2)),
    'entrega', jsonb_build_object('dias', 5, 'tipo', 'habiles'),
    'proveedor', (array['Aceros del Norte', 'Ferreteria Industrial MX', 'Distribuidora Sierra'])[1 + (p_costo::int % 3)],
    'nota', 'Demo', 'response_hours', round((random() * 40)::numeric, 1)));
end $$;

do $$
declare
  buyers uuid[]; sellers uuid[]; custs uuid[];
  names text[] := array['Minera Sierra Alta', 'Constructora Chihuahua', 'Maquiladora del Norte', 'Aceros y Perfiles SA', 'Transportes Delicias',
                        'Agroindustrias Cuauhtemoc', 'Taller Mecanico Ramirez', 'Hospital Regional'];
  products text[] := array['Guante de carnaza', 'Casco dielectrico', 'Lente de seguridad', 'Disco de corte 7 pulgadas', 'Electrodo 6013',
                           'Bota industrial', 'Chaleco reflejante', 'Taladro percutor', 'Cinta de aislar', 'Respirador media cara'];
  b uuid; s uuid; v_req uuid; v_item uuid; i int; k int; n_items int; v_days numeric; v_item_ids uuid[];
  v_sub timestamptz;
begin
  select array_agg(id order by created_at) into buyers from public.profiles where rol = 'comprador' and activo;
  select array_agg(id order by created_at) into sellers from (select id, created_at from public.profiles where rol = 'vendedor' and activo order by created_at limit 3) x;
  if buyers is null then raise exception 'Falta al menos un comprador activo'; end if;
  if sellers is null then raise exception 'Crea al menos un vendedor en Comprador > Usuarios antes de cargar la demo'; end if;
  b := buyers[1];

  -- Necesario para registrar costos desde SQL Editor (en el portal lo hace el comprador).
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', b::text, true);

  for i in 1..array_length(names, 1) loop
    insert into public.customers (nombre, tipo, created_by, rfc, direccion, contacto_telefono)
    values (names[i], case when i <= 5 then 'cliente' else 'prospecto' end::public.customer_kind, b,
            'DEM0101' || lpad(i::text, 2, '0') || 'AB1', 'Parque Industrial ' || i || ', Cd. Juarez, Chih.', '656 000 00' || lpad(i::text, 2, '0'))
    on conflict do nothing;
  end loop;
  select array_agg(id order by nombre) into custs from public.customers where nombre = any (names);

  for i in 1..15 loop
    s := sellers[1 + (i % array_length(sellers, 1))];
    v_req := gen_random_uuid();
    n_items := case when i in (13, 6, 10) then 3 when i % 2 = 0 then 2 else 1 end;
    perform set_config('request.jwt.claim.sub', s::text, true);
    insert into public.quote_requests (id, vendedor_id, customer_id, notas)
    values (v_req, s, custs[1 + (i % array_length(custs, 1))], 'Solicitud de demostracion ' || i);
    v_item_ids := '{}';
    for k in 1..n_items loop
      v_item := gen_random_uuid();
      insert into public.quote_items (id, request_id, posicion, producto, descripcion, cantidad, unidad)
      values (v_item, v_req, k, products[1 + ((i + k) % array_length(products, 1))],
              'Uso industrial en planta, demostracion ' || i || '-' || k, 5 * k * (1 + i % 4),
              (array['pieza', 'par', 'caja'])[1 + (k % 3)]);
      insert into public.item_references (item_id, tipo, url) values (v_item, 'link', 'https://ejemplo.com/producto/' || i || '-' || k);
      v_item_ids := v_item_ids || v_item;
    end loop;

    if i = 15 then continue; end if; -- borrador

    update public.quote_requests set estado = 'enviada', due_at = now() + interval '3 days' where id = v_req;

    -- Distintos tiempos: reescribe fechas de envio y vencimiento (solo demo).
    v_days := case when i <= 3 then 0.2 * i when i <= 5 then 6 + i else 1.5 * i end;
    v_sub := now() - make_interval(secs => (v_days * 86400)::int);
    alter table public.quote_requests disable trigger quote_requests_guard;
    update public.quote_requests set submitted_at = v_sub, due_at = v_sub + interval '2 days' where id = v_req;
    alter table public.quote_requests enable trigger quote_requests_guard;

    -- Respuestas
    if i in (6, 7, 8, 9) then                     -- cotizadas sin enviar
      foreach v_item in array v_item_ids loop perform pg_temp.demo_quote(v_item, 80 + i * 17, case when i % 2 = 0 then 12 else null end, b); end loop;
    elsif i in (10, 11) then                      -- cotizadas y enviadas al cliente
      foreach v_item in array v_item_ids loop
        perform pg_temp.demo_quote(v_item, 120 + i * 11, null, b);
        perform set_config('request.jwt.claim.sub', s::text, true);
        perform set_config('request.jwt.claim.role', 'authenticated', true);
        perform public.mark_item_dispatched(v_item, 1 + (i + array_position(v_item_ids, v_item)) % 5);
        perform set_config('request.jwt.claim.role', 'service_role', true);
      end loop;
    elsif i = 12 then                             -- no encontrada
      perform set_config('request.jwt.claim.sub', b::text, true);
      foreach v_item in array v_item_ids loop
        perform public.respond_item(v_item, 'not_found', jsonb_build_object('nota', 'Sin proveedor en la region', 'response_hours', 6.5));
      end loop;
    elsif i = 13 then                             -- mezcla: cotizada, no encontrada, pendiente
      perform pg_temp.demo_quote(v_item_ids[1], 950, null, b);
      perform set_config('request.jwt.claim.sub', b::text, true);
      perform public.respond_item(v_item_ids[2], 'not_found', jsonb_build_object('nota', 'Descontinuado por el fabricante', 'response_hours', 20));
    elsif i = 14 then                             -- no encontrada y luego recotizada
      perform set_config('request.jwt.claim.sub', b::text, true);
      perform public.respond_item(v_item_ids[1], 'not_found', jsonb_build_object('nota', 'No se encontro, se vuelve a buscar', 'response_hours', 30));
      perform pg_temp.demo_quote(v_item_ids[1], 240, 35, b);
      perform pg_temp.demo_quote(v_item_ids[2], 60, null, b);
    end if;
    -- 1 a 5: quedan pendientes (1 a 3 recientes, 4 y 5 vencidas)
  end loop;
  raise notice 'Demo cargada: 8 clientes y 15 solicitudes.';
end $$;
