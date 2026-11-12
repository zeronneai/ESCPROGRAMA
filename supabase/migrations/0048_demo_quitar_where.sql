-- =============================================================================
-- 0048_demo_quitar_where.sql
-- Arregla el boton "Quitar demostracion" (Configuracion): marcaba "DELETE requires a WHERE clause"
-- porque Supabase no deja borrar una tabla completa sin WHERE. Solo cambia ese renglon; solo borra
-- los ejemplos de la demostracion, no lo que ustedes capturaron.
-- Se puede correr en cualquier momento (no depende de 0045, 0046 ni 0047).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.demo_quitar() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid[]; v_r uuid[]; v_i uuid[]; v_is uuid[]; v_q uuid[]; v_s uuid[]; v_b uuid[]; v_v uuid[]; v_g uuid[]; v_k uuid[];
  t text; n integer;
  tablas text[] := array['quote_issue_sends', 'quote_issue_lines', 'quote_issues', 'quote_renegotiations', 'item_outcomes', 'item_purchases',
    'item_pdf_names', 'item_price_choice', 'item_update_requests', 'item_dispatch', 'item_sourcing', 'item_clarification_pauses',
    'item_messages', 'item_quotes', 'item_costs', 'item_references', 'quote_pdf_shipping_items', 'quote_pdf_min_choices', 'quote_pdf_data',
    'quote_items', 'quote_requests', 'venta_lineas', 'ventas', 'bitacora_articulos', 'bitacora_eventos', 'bitacora', 'calidad_archivos',
    'calidad_eventos', 'acciones_correctivas', 'quejas', 'consumo_eventos', 'consumo_solicitudes', 'guia_eventos', 'guias',
    'encuestas_cliente', 'customers', 'notifications', 'demo_cargas'];
begin
  if not public.is_buyer() then raise exception 'Solo el comprador quita la demostracion' using errcode = '42501'; end if;
  select array_agg(id) into v_c from public.customers where nombre like '%(Demo)%';
  v_c := coalesce(v_c, '{}');
  select coalesce(array_agg(id), '{}') into v_r from public.quote_requests where customer_id = any (v_c);
  select coalesce(array_agg(id), '{}') into v_i from public.quote_items where request_id = any (v_r);
  select coalesce(array_agg(id), '{}') into v_is from public.quote_issues where request_id = any (v_r);
  select coalesce(array_agg(id), '{}') into v_q from public.quejas where customer_id = any (v_c) or cliente_nombre like '%(Demo)%';
  select coalesce(array_agg(id), '{}') into v_s from public.acciones_correctivas where queja_id = any (v_q);
  select coalesce(array_agg(id), '{}') into v_b from public.bitacora where customer_id = any (v_c);
  select coalesce(array_agg(id), '{}') into v_v from public.ventas where customer_id = any (v_c);
  select coalesce(array_agg(id), '{}') into v_g from public.guias where customer_id = any (v_c) or destinatario like '%(Demo)%';
  select coalesce(array_agg(id), '{}') into v_k from public.consumo_solicitudes
   where (descripcion, motivo) in (('Hojas tamaño carta', 'Se acabaron, se usan para imprimir cotizaciones'),
                                   ('Afinación y cambio de aceite camioneta de reparto', 'Ya le toca por kilometraje'),
                                   ('Cloro y jabón para trastes', 'Limpieza de la oficina'),
                                   ('Café molido', 'Para clientes que visitan la oficina'),
                                   ('Hojas tamano carta', 'Se acabaron, se usan para imprimir cotizaciones'),
                                   ('Afinacion y cambio de aceite camioneta de reparto', 'Ya le toca por kilometraje'),
                                   ('Cloro y jabon para trastes', 'Limpieza de la oficina'),
                                   ('Cafe molido', 'Para clientes que visitan la oficina'));

  foreach t in array tablas loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  update public.quote_issues set renegociacion_id = null where id = any (v_is);
  delete from public.quote_issue_sends where issue_id = any (v_is);
  delete from public.quote_issue_lines where issue_id = any (v_is) or item_id = any (v_i);
  delete from public.quote_renegotiations where request_id = any (v_r);
  delete from public.quote_issues where id = any (v_is);
  foreach t in array array['item_outcomes', 'item_purchases', 'item_pdf_names', 'item_price_choice', 'item_update_requests', 'item_dispatch',
                           'item_sourcing', 'item_clarification_pauses', 'item_messages', 'item_quotes', 'item_costs', 'item_references',
                           'quote_pdf_shipping_items'] loop
    execute format('delete from public.%I where item_id = any ($1)', t) using v_i;
  end loop;
  delete from public.quote_pdf_min_choices where request_id = any (v_r) or item_id = any (v_i);
  delete from public.quote_pdf_data where request_id = any (v_r);
  delete from public.venta_lineas where venta_id = any (v_v);
  delete from public.ventas where id = any (v_v) or request_id = any (v_r);
  delete from public.bitacora_articulos where bitacora_id = any (v_b);
  delete from public.bitacora_eventos where bitacora_id = any (v_b);
  delete from public.bitacora where id = any (v_b) or request_id = any (v_r);
  delete from public.quote_items where id = any (v_i);
  delete from public.quote_requests where id = any (v_r);
  delete from public.calidad_archivos where queja_id = any (v_q) or sac_id = any (v_s);
  delete from public.calidad_eventos where queja_id = any (v_q) or sac_id = any (v_s);
  delete from public.acciones_correctivas where id = any (v_s);
  delete from public.quejas where id = any (v_q);
  delete from public.consumo_eventos where solicitud_id = any (v_k);
  delete from public.consumo_solicitudes where id = any (v_k);
  delete from public.guia_eventos where guia_id = any (v_g);
  delete from public.guias where id = any (v_g);
  delete from public.encuestas_cliente where customer_id = any (v_c);
  delete from public.notifications
   where ref_id = any (v_r || v_i || v_q || v_s || v_b || v_v || v_g || v_k || v_is);
  update public.customers set parent_id = null, sucursal = null where parent_id = any (v_c) and not (id = any (v_c));
  delete from public.customers where id = any (v_c);
  get diagnostics n = row_count;
  delete from public.demo_cargas where true;  -- Supabase no deja borrar sin WHERE
  foreach t in array tablas loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  perform public.write_audit('demo_quitada', 'demo_cargas', null, null, null,
    jsonb_build_object('clientes', n, 'solicitudes', cardinality(v_r), 'ventas', cardinality(v_v), 'quejas', cardinality(v_q), 'guias', cardinality(v_g)));
  return n || ' clientes de demostración y todo lo ligado a ellos';
end $$;

commit;
