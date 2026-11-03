-- =============================================================================
-- BORRAR DATOS DE PRUEBA  (correlo SOLO cuando quieras empezar en limpio; NO se puede deshacer)
-- Requiere 0028 ya aplicado.
--
-- BORRA: solicitudes y partidas, cotizaciones y envios al cliente, PDFs registrados, aclaraciones,
--        compras, clientes y prospectos, bitacora de ventas/prospeccion, leads, quejas, acciones
--        correctivas, consumo interno, guias, ventas diarias, evaluaciones, minutas, avisos de la campanita y la bitacora de auditoria.
--        Los folios vuelven a empezar en 1 (COT, QC, SAC, CI y G).
-- CONSERVA: usuarios (todos), configuracion, dias festivos, datos de la empresa, tabulador de
--        precios, proveedores y el catalogo de articulos.
-- Los archivos ya subidos (imagenes, guias, evidencias) quedan en Storage sin uso; si quieres
-- borrarlos, vacia los buckets desde Supabase > Storage.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.audit_log disable trigger audit_log_no_truncate;

truncate table
  public.minuta_firmas, public.minutas,
  public.encuestas_cliente, public.eval_proveedor, public.eval_periodos,
  public.venta_lineas, public.ventas,
  public.guia_eventos, public.guias,
  public.consumo_eventos, public.consumo_solicitudes,
  public.calidad_archivos, public.calidad_eventos, public.acciones_correctivas, public.quejas,
  public.demo_cargas, public.bitacora_articulos, public.bitacora_eventos, public.bitacora,
  public.lead_activities, public.leads,
  public.quote_issue_sends, public.quote_issue_lines, public.quote_renegotiations, public.quote_issues,
  public.quote_pdf_shipping_items, public.quote_pdf_min_choices, public.quote_pdf_data,
  public.item_messages, public.item_clarification_pauses, public.item_update_requests, public.item_purchases,
  public.item_sourcing, public.item_pdf_names, public.item_price_choice, public.item_outcomes, public.item_dispatch,
  public.item_quotes, public.item_costs, public.item_references, public.quote_items, public.quote_requests,
  public.customers, public.notifications, public.folio_counters, public.audit_log
restart identity cascade;

alter table public.audit_log enable trigger audit_log_no_truncate;

alter sequence public.quejas_seq restart with 1;
alter sequence public.sac_seq restart with 1;
alter sequence public.consumo_seq restart with 1;
alter sequence public.guias_seq restart with 1;
alter sequence public.minutas_seq restart with 1;

-- La encuesta de satisfaccion de clientes vuelve a quedar activa hasta el 1 de marzo de 2027.
do $$
declare v uuid;
begin
  if current_date < date '2027-03-01' then
    v := public.eval_activar_core('clientes', null);
    update public.eval_periodos set cierra_el = date '2027-03-01' where id = v;
  end if;
end $$;

commit;

-- VERIFICACION:
--   select (select count(*) from public.quote_requests) as solicitudes, (select count(*) from public.customers) as clientes,
--          (select count(*) from public.bitacora) as bitacora, (select count(*) from public.profiles) as usuarios;
--   -- 0, 0, 0 y tus usuarios
