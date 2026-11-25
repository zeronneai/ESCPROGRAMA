-- Revisa que actualizaciones (0059 a 0082) ya estan corridas en la base.
-- Pegalo en el SQL Editor de Supabase y presiona Run. No cambia nada, solo consulta.
select actualizacion,
       case when ya then 'Ya está corrida' else 'FALTA correrla' end as estado
from (values
  ('0059 Planeación de compras',            to_regclass('public.plan_proveedores') is not null),
  ('0060 Datos de proveedor para la OC',    exists (select 1 from information_schema.columns where table_schema='public' and table_name='plan_proveedores' and column_name='razon_social')),
  ('0061 Pedido típico',                    exists (select 1 from information_schema.columns where table_schema='public' and table_name='plan_articulos' and column_name='pedido_tipico')),
  ('0062 Guías: recolección u ocurre',      exists (select 1 from information_schema.columns where table_schema='public' and table_name='guias' and column_name='entrega_modo')),
  ('0063 Cotizar con aclaración pendiente', to_regproc('public.continuar_sin_aclaracion') is not null),
  ('0064 Pegatron de línea / sobrepedido',  exists (select 1 from information_schema.columns where table_schema='public' and table_name='pegatron_oc' and column_name='tipo')),
  ('0065 Pausa en prospección',             exists (select 1 from information_schema.columns where table_schema='public' and table_name='bitacora' and column_name='pausada_at')),
  ('0066 Prospecto que compra sale',        to_regproc('public.prospeccion_cerrar_cliente') is not null),
  ('0067 Unir prospecto con su cliente',    exists (select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='unido_a')),
  ('0068 Cliente solo con factura',         exists (select 1 from pg_trigger where tgname='customers_solo_factura')),
  ('0069 Puesto Auxiliar de finanzas',      exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='user_role' and e.enumlabel='aux_finanzas')),
  ('0070 Recepción de facturas',            to_regclass('public.factura_recepcion') is not null),
  ('0071 Tipo de cambio',                   to_regclass('public.tipos_cambio') is not null),
  ('0072 Comisiones',                       exists (select 1 from information_schema.columns where table_schema='public' and table_name='venta_lineas' and column_name='comision_pct')),
  ('0073 Fecha de pago obligatoria',        exists (select 1 from pg_proc where proname='ventas_before' and prosrc like '%FECHA_PAGO_FALTA%')),
  ('0074 Revisión de comisiones',           exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='comision_revisada_at')),
  ('0075 Envío en la comisión',             exists (select 1 from information_schema.columns where table_schema='public' and table_name='venta_lineas' and column_name='envio')),
  ('0076 Conciliaciones bancarias',         to_regclass('public.conciliacion_movimientos') is not null),
  ('0077 Plazo de 7 días en conciliaciones', exists (select 1 from information_schema.columns where table_schema='public' and table_name='conciliacion_movimientos' and column_name='tardio')),
  ('0078 Pedidos de vendedores y asistente', to_regclass('public.pedidos_vendedor') is not null),
  ('0079 Meta diaria de prospeccion', to_regclass('public.prospeccion_config') is not null),
  ('0080 Metas mensuales de venta', to_regclass('public.metas_venta') is not null),
  ('0081 Metas por periodo y pantalla publica', to_regclass('public.metas_config') is not null),
  ('0082 Tipo de cambio del pago', exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='tipo_cambio_pago'))
) as x(actualizacion, ya)
order by actualizacion;
