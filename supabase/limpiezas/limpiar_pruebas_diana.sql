-- =============================================================================
-- limpiar_pruebas_diana.sql   (limpieza de una sola vez, no es actualizacion)
-- Borra pruebas REALES (no de la demostracion) de la vendedora Diana Fierro que afectan indicadores:
--   * Prospeccion: los prospectos "Prueba Web SA" y "vgvgt" (con su historial) y esas dos empresas
--     de prueba (y sus leads del sitio web), si no tienen nada mas.
--   * Cotizaciones: COT-2026-0001 y COT-2026-0002 (SIGMA ALIMENTOS), con sus partidas, precios,
--     mensajes y PDF. El cliente SIGMA ALIMENTOS NO se borra.
-- Si encuentra algo distinto a lo esperado, no borra nada y avisa.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que borro.
-- =============================================================================
do $$
declare
  v_diana uuid; n integer;
  v_ventas uuid[] := '{}'; v_reqs uuid[]; v_items uuid[]; v_issues uuid[]; v_bit uuid[]; v_cust uuid[]; v_leads uuid[] := '{}';
  tareas text[] := '{}'; pendientes text[]; t text; r record; pasada integer := 0;
  tablas text[] := '{}';
begin
  select count(*), min(id::text)::uuid into n, v_diana from public.profiles where lower(trim(nombre)) = 'diana fierro';
  if n <> 1 then raise exception 'Encontre % usuarios llamados "Diana Fierro"; no borro nada.', n; end if;

  select coalesce(array_agg(id), '{}') into v_cust from public.customers
   where lower(trim(nombre)) in ('prueba web sa', 'vgvgt') and parent_id is null;
  select coalesce(array_agg(id), '{}') into v_bit from public.bitacora
   where customer_id in (select id from public.customers where id = any (v_cust) or parent_id = any (v_cust));
  if cardinality(v_bit) = 0 then raise notice 'No encontre los prospectos de prueba (quiza ya se borraron).'; end if;
  if exists (select 1 from public.bitacora where id = any (v_bit) and vendedor_id is distinct from v_diana and vendedor_id is not null) then
    raise exception 'Uno de esos prospectos es de otro vendedor; no borro nada.';
  end if;
  if exists (select 1 from public.ventas where customer_id = any (v_cust) and cancelada_at is null) then
    raise exception 'Esas empresas de prueba tienen ventas registradas; no borro nada.';
  end if;

  select coalesce(array_agg(id), '{}') into v_reqs from public.quote_requests
   where folio in ('COT-2026-0001', 'COT-2026-0002') and vendedor_id = v_diana;
  -- Tambien las solicitudes que se hubieran hecho a las empresas de prueba.
  select coalesce(array_agg(distinct id), '{}') into v_reqs from public.quote_requests
   where id = any (v_reqs) or customer_id = any (v_cust);
  if exists (select 1 from public.quote_requests qr join public.customers c on c.id = qr.customer_id
              where qr.id = any (v_reqs) and qr.folio in ('COT-2026-0001', 'COT-2026-0002') and c.nombre not ilike '%sigma%') then
    raise exception 'COT-2026-0001/0002 no son de SIGMA ALIMENTOS; no borro nada.';
  end if;
  select coalesce(array_agg(id), '{}') into v_items from public.quote_items where request_id = any (v_reqs);
  select coalesce(array_agg(id), '{}') into v_issues from public.quote_issues where request_id = any (v_reqs);
  if to_regclass('public.leads') is not null then
    execute 'select coalesce(array_agg(id), ''{}'') from public.leads where customer_id = any ($1)' into v_leads using v_cust;
  end if;

  raise notice 'A borrar: % prospecto(s), % solicitud(es) (%), % empresa(s) de prueba, % lead(s).',
    cardinality(v_bit), cardinality(v_reqs), (select string_agg(folio, ', ') from public.quote_requests where id = any (v_reqs)), cardinality(v_cust), cardinality(v_leads);

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
  tareas := tareas || format('delete from public.notifications where ref_id = any (%L::uuid[])', v_reqs || v_bit || v_leads);
  tareas := tareas || format('delete from public.quote_issues where id = any (%L::uuid[])', v_issues);
  tareas := tareas || format('delete from public.quote_items where id = any (%L::uuid[])', v_items);
  tareas := tareas || format('delete from public.ventas where id = any (%L::uuid[])', v_ventas);
  tareas := tareas || format('delete from public.bitacora where id = any (%L::uuid[])', v_bit);
  tareas := tareas || format('delete from public.quote_requests where id = any (%L::uuid[])', v_reqs);
  tareas := tareas || format('update public.ventas set request_id = null where request_id = any (%L::uuid[])', v_reqs);
  if cardinality(v_leads) > 0 then
    tareas := tareas || format('delete from public.leads where id = any (%L::uuid[])', v_leads);
    tablas := tablas || array['leads'];
  end if;
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
  -- Las empresas de prueba: solo si ya no tienen nada (si algo las usa, se quedan).
  select coalesce(array_agg(id order by parent_id nulls last), '{}') into v_ventas from public.customers where id = any (v_cust) or parent_id = any (v_cust);
  alter table public.customers disable trigger user;
  foreach t in array v_ventas::text[] loop
    begin
      delete from public.customers where id = t::uuid;
    exception when foreign_key_violation then
      raise notice 'La empresa % se queda porque algo mas la usa.', t;
    end;
  end loop;
  alter table public.customers enable trigger user;

  perform public.write_audit('limpieza_pruebas', 'bitacora', null, null, null,
    jsonb_build_object('vendedora', 'Diana Fierro', 'solicitudes', cardinality(v_reqs), 'prospectos', cardinality(v_bit), 'empresas', cardinality(v_cust)));
  raise notice 'Listo: se borraron % prospecto(s) y % solicitud(es) de cotizacion de prueba.', cardinality(v_bit), cardinality(v_reqs);
end $$;
