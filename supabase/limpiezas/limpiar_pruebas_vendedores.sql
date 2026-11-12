-- =============================================================================
-- limpiar_pruebas_vendedores.sql   (limpieza de una sola vez, no es actualizacion)
-- Borra las pruebas que se ven en la tabla de vendedores:
--   * Usuario "Prueba": TODAS sus ventas, sus solicitudes de cotizacion (con sus partidas, precios,
--     mensajes, PDF y cotizaciones) y sus prospectos de bitacora.
--   * "Diana Fierro": solo su(s) venta(s) de prueba registradas ANTES del 12 de noviembre de 2026.
--     Sus prospectos y lo que registre desde el 12 de noviembre NO se tocan.
-- No borra a los usuarios ni a los clientes. Si alguna carga de almacen estaba ligada a esas ventas,
-- solo se desliga.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que borro.
-- =============================================================================
do $$
declare
  v_prueba uuid; v_diana uuid; n integer;
  v_ventas uuid[]; v_reqs uuid[]; v_items uuid[]; v_issues uuid[]; v_bit uuid[];
  tareas text[] := '{}'; pendientes text[]; t text; r record; pasada integer := 0;
  tablas text[] := '{}';
  borrado jsonb := '{}';
begin
  select count(*), min(id::text)::uuid into n, v_prueba from public.profiles where lower(trim(nombre)) = 'prueba';
  if n <> 1 then raise exception 'Encontre % usuarios llamados "Prueba"; no borro nada.', n; end if;
  select count(*), min(id::text)::uuid into n, v_diana from public.profiles where lower(trim(nombre)) = 'diana fierro';
  if n > 1 then raise exception 'Hay % usuarios llamados "Diana Fierro"; no borro nada.', n; end if;

  select coalesce(array_agg(id), '{}') into v_ventas from public.ventas
   where vendedor_id = v_prueba
      or (v_diana is not null and vendedor_id = v_diana and created_at < timestamptz '2026-11-12 00:00:00-06');
  select coalesce(array_agg(id), '{}') into v_reqs from public.quote_requests where vendedor_id = v_prueba;
  select coalesce(array_agg(id), '{}') into v_items from public.quote_items where request_id = any (v_reqs);
  select coalesce(array_agg(id), '{}') into v_issues from public.quote_issues where request_id = any (v_reqs);
  select coalesce(array_agg(id), '{}') into v_bit from public.bitacora where vendedor_id = v_prueba;

  for r in select string_agg(format('%s %s', coalesce(factura, 'sin factura'), coalesce(monto::text, '')), ', ') as l from public.ventas where id = any (v_ventas) loop
    raise notice 'Ventas a borrar (%): %', cardinality(v_ventas), coalesce(r.l, 'ninguna');
  end loop;
  raise notice 'Solicitudes de Prueba a borrar: %  ·  Prospectos de Prueba: %', cardinality(v_reqs), cardinality(v_bit);

  -- Lo que depende de esas solicitudes, partidas, incidencias, ventas y prospectos (en cualquier tabla).
  for r in select c.table_name, c.column_name from information_schema.columns c
            join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name in ('request_id', 'item_id', 'issue_id', 'venta_id', 'bitacora_id')
  loop
    if r.table_name in ('quote_requests', 'quote_items', 'quote_issues', 'ventas', 'bitacora') and r.column_name in ('request_id', 'item_id', 'issue_id', 'venta_id', 'bitacora_id')
       and not (r.table_name = 'quote_items' and r.column_name = 'request_id')
       and not (r.table_name = 'quote_issues' and r.column_name = 'request_id') then
      -- Otros registros que solo apuntan a la solicitud o venta (de otros vendedores): se desligan.
      tareas := tareas || format('update public.%I set %I = null where %I = any (%L::uuid[])', r.table_name, r.column_name, r.column_name,
                  case r.column_name when 'request_id' then v_reqs when 'item_id' then v_items when 'issue_id' then v_issues when 'venta_id' then v_ventas else v_bit end);
      continue;
    end if;
    if r.table_name = 'salidas' and r.column_name = 'venta_id' then
      tareas := tareas || format('update public.salidas set venta_id = null where venta_id = any (%L::uuid[])', v_ventas);
      continue;
    end if;
    tablas := array_append(tablas, r.table_name);
    tareas := tareas || format('delete from public.%I where %I = any (%L::uuid[])', r.table_name, r.column_name,
                case r.column_name when 'request_id' then v_reqs when 'item_id' then v_items when 'issue_id' then v_issues when 'venta_id' then v_ventas else v_bit end);
  end loop;
  tareas := tareas || format('update public.quote_issues set renegociacion_id = null where request_id = any (%L::uuid[])', v_reqs);
  tareas := tareas || format('delete from public.notifications where ref_id = any (%L::uuid[])', v_ventas || v_reqs || v_bit);
  tareas := tareas || format('delete from public.quote_issues where id = any (%L::uuid[])', v_issues);
  tareas := tareas || format('delete from public.quote_items where id = any (%L::uuid[])', v_items);
  tareas := tareas || format('delete from public.ventas where id = any (%L::uuid[])', v_ventas);
  tareas := tareas || format('delete from public.bitacora where id = any (%L::uuid[])', v_bit);
  tareas := tareas || format('delete from public.quote_requests where id = any (%L::uuid[])', v_reqs);
  tablas := tablas || array['notifications', 'quote_issues', 'quote_items', 'ventas', 'bitacora', 'quote_requests', 'salidas'];

  select array_agg(distinct x) into tablas from unnest(tablas) x where to_regclass('public.' || x) is not null;
  foreach t in array tablas loop execute format('alter table public.%I disable trigger user', t); end loop;

  -- Se repite hasta que todo se borra (el orden lo resuelven las pasadas).
  loop
    pasada := pasada + 1;
    pendientes := '{}';
    foreach t in array tareas loop
      begin
        execute t;
      exception when foreign_key_violation then
        pendientes := pendientes || t;
      end;
    end loop;
    exit when cardinality(pendientes) = 0;
    if pasada >= 12 or cardinality(pendientes) = cardinality(tareas) and pasada > 1 then
      foreach t in array tablas loop execute format('alter table public.%I enable trigger user', t); end loop;
      raise exception 'No se pudo borrar todo (algo mas depende de estos registros): %', left(pendientes[1], 300);
    end if;
    tareas := pendientes;
  end loop;

  foreach t in array tablas loop execute format('alter table public.%I enable trigger user', t); end loop;
  perform public.write_audit('limpieza_pruebas', 'ventas', null, null, null,
    jsonb_build_object('ventas', cardinality(v_ventas), 'solicitudes', cardinality(v_reqs), 'prospectos', cardinality(v_bit)));
  raise notice 'Listo: se borraron % venta(s), % solicitud(es) de cotizacion y % prospecto(s) de prueba.', cardinality(v_ventas), cardinality(v_reqs), cardinality(v_bit);
end $$;
