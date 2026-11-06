-- =============================================================================
-- 0040_tiempo_real.sql
-- TIEMPO REAL en todo el portal: cuando alguien sube una factura, pide una guia, cotiza, paga, etc.,
-- las pantallas abiertas de los demas se actualizan solas (sin recargar la pagina).
-- Activa Supabase Realtime en las tablas del portal. Cada usuario solo recibe los cambios que sus
-- permisos le dejan ver (Realtime respeta las mismas reglas de seguridad).
-- Se puede correr mas de una vez sin problema.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['notifications', 'quote_requests', 'quote_items', 'item_quotes', 'item_messages', 'item_purchases', 'item_dispatch', 'item_outcomes', 'item_update_requests', 'quote_issues', 'guias', 'guia_eventos', 'ventas', 'customers', 'bitacora', 'leads', 'salidas', 'salida_lineas', 'recepciones', 'etiquetas', 'pagos', 'ordenes_compra', 'consumo_solicitudes', 'quejas', 'acciones_correctivas', 'calidad_eventos', 'control_cambios', 'documentos', 'minutas', 'encuestas_cliente'] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- VERIFICACION:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;   -- 30 tablas
