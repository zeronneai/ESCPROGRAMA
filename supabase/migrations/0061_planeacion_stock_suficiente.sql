-- =============================================================================
-- 0061_planeacion_stock_suficiente.sql   (requiere 0059)
-- Venta real mas fina en planeacion de compras: ademas de los dias en CERO, cuentan como desabasto los dias
-- en que la existencia no alcanzaba para un pedido normal del articulo (el "pedido tipico": 3 de cada 4
-- pedidos son de esa cantidad o menos). Esos dias tambien esconden venta.
--  * plan_historial: dias con stock suficiente y lo vendido en esos dias (venta y traspasos).
--  * plan_articulos: pedido tipico.
-- Despues corre otra vez cargas/planeacion_compras_inicial.sql (la version nueva llena estos datos).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;
alter table public.plan_historial
  add column if not exists dias_suficiente int not null default 0,
  add column if not exists venta_suficiente numeric(14, 3) not null default 0,
  add column if not exists traspasos_suficiente numeric(14, 3) not null default 0;
alter table public.plan_articulos
  add column if not exists pedido_tipico numeric(14, 3) check (pedido_tipico is null or pedido_tipico >= 0);
commit;
