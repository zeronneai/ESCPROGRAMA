-- =============================================================================
-- limpiar_prospectos_sitio_web.sql   (limpieza de una sola vez, no es actualizacion)
-- Borra los prospectos que entraron por el formulario del SITIO WEB (pruebas):
--   * Los registros de Prospeccion con origen "sitio_web", su historial, sus articulos y sus avisos.
--   * La empresa que se dio de alta sola con ese prospecto, SOLO si no tiene nada mas
--     (cotizaciones, ventas, quejas, guias, evaluaciones, sucursales ni otros registros).
-- Si un prospecto web ya lo convirtieron en cotizacion o venta, esa cotizacion o venta NO se borra.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice cuanto borro.
-- =============================================================================
do $$
declare
  v_b uuid[]; v_c uuid[]; n_b integer; n_c integer;
  t text;
  tablas text[] := array['bitacora_articulos', 'bitacora_eventos', 'bitacora', 'customers', 'notifications'];
begin
  select coalesce(array_agg(id), '{}') into v_b from public.bitacora where origen = 'sitio_web';
  -- Empresas que se crearon con el prospecto web y no se usan en nada mas.
  select coalesce(array_agg(c.id), '{}') into v_c
    from public.customers c
   where c.tipo = 'prospecto'
     and exists (select 1 from public.bitacora b where b.id = any (v_b) and b.customer_id = c.id
                  and c.created_at >= b.created_at - interval '1 minute')
     and not exists (select 1 from public.bitacora b where b.customer_id = c.id and not (b.id = any (v_b)))
     and not exists (select 1 from public.quote_requests r where r.customer_id = c.id)
     and not exists (select 1 from public.ventas v where v.customer_id = c.id)
     and not exists (select 1 from public.quejas q where q.customer_id = c.id)
     and not exists (select 1 from public.guias g where g.customer_id = c.id)
     and not exists (select 1 from public.encuestas_cliente e where e.customer_id = c.id)
     and not exists (select 1 from public.leads l where l.customer_id = c.id)
     and not exists (select 1 from public.customers h where h.parent_id = c.id);

  foreach t in array tablas loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  delete from public.notifications where ref_id = any (v_b);
  delete from public.bitacora_articulos where bitacora_id = any (v_b);
  delete from public.bitacora_eventos where bitacora_id = any (v_b);
  delete from public.bitacora where id = any (v_b);
  get diagnostics n_b = row_count;
  delete from public.customers where id = any (v_c);
  get diagnostics n_c = row_count;
  foreach t in array tablas loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  perform public.write_audit('limpieza_sitio_web', 'bitacora', null, null, null, jsonb_build_object('prospectos', n_b, 'empresas', n_c));
  raise notice 'Listo: se borraron % prospecto(s) del sitio web y % empresa(s) que se dieron de alta con ellos.', n_b, n_c;
end $$;
