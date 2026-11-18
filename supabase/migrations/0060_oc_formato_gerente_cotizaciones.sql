-- =============================================================================
-- 0060_oc_formato_gerente_cotizaciones.sql   (requiere 0059)
--  * PURCHASE ORDER en el formato de ESC: cada proveedor de planeacion guarda su razon social, a quien va
--    dirigida (AT'N) y a donde se envia (Ship to). Los articulos ya tenian el MODEL y el PRODUCT en ingles.
--  * La GERENTE ve las cotizaciones completas (solicitud, respuestas, imagenes, precios, costos y etapas)
--    pero NUNCA lo del comprador: proveedor, links de compra, contacto, numero de parte ni notas de compra.
--    Los costos se leen con costos_solicitud(), que no regresa el proveedor.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.plan_proveedores
  add column if not exists razon_social text check (razon_social is null or length(razon_social) <= 200),
  add column if not exists contacto text check (contacto is null or length(contacto) <= 120),
  add column if not exists enviar_a text check (enviar_a is null or length(enviar_a) <= 300);

-- Costo y envio por partida (sin proveedor) para el comprador y la gerente.
create or replace function public.costos_solicitud(p_request uuid)
returns table (item_id uuid, version smallint, costo numeric, envio numeric)
language sql stable security definer set search_path = public as $$
  select c.item_id, c.version, c.costo, c.envio
  from public.item_costs c
  join public.quote_items i on i.id = c.item_id
  where i.request_id = p_request
    and (public.is_buyer() or public.is_gerente())
    and public.can_read_request(p_request);
$$;
revoke all on function public.costos_solicitud(uuid) from public, anon;
grant execute on function public.costos_solicitud(uuid) to authenticated;

commit;
