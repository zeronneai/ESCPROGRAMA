-- =============================================================================
-- 0033_ceo_lectura.sql   (requiere 0032 ya aplicado)
-- El CEO ve TODO lo que ve la gerente (ventas, clientes, bitacora, cotizaciones enviadas, quejas,
-- acciones correctivas, consumo, guias, evaluaciones, minutas, control de cambios), sin editar,
-- ademas de lo suyo en Pagos a proveedores extranjeros.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
create or replace function public.is_gerente() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('gerente') or public.has_role('ceo');
$$;
