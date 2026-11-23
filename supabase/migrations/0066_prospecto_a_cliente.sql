-- =============================================================================
-- 0066_prospecto_a_cliente.sql   (requiere 0065 ya aplicado)
-- Cuando un prospecto compra, su registro de prospeccion se cierra como "Se volvio cliente"
-- (resultado = ganada) y sale de los prospectos activos; su historial se queda.
-- 1) La venta con factura muchas veces queda en una SUCURSAL del cliente (domicilio de entrega).
--    Antes solo se cerraba la prospeccion si la venta era del mismo registro exacto, por eso el
--    prospecto seguia apareciendo. Ahora se toma en cuenta la matriz y sus sucursales.
-- 2) Si el vendedor (o alguien) cambia a mano el estatus a "cliente", tambien se cierra.
-- 3) Se corrigen los prospectos que ya compraron y siguen abiertos.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- Cierra la prospeccion abierta de un cliente (matriz y sucursales) y deja la nota en su historial.
create or replace function public.prospeccion_cerrar_cliente(p_customer uuid, p_vendedor uuid, p_fecha date, p_monto numeric, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare v_matriz uuid; b record;
begin
  select coalesce(parent_id, id) into v_matriz from public.customers where id = p_customer;
  if v_matriz is null then return; end if;
  for b in
    select x.id from public.bitacora x
     where x.resultado = 'abierta' and x.archived_at is null
       and (p_vendedor is null or x.vendedor_id = p_vendedor or x.vendedor_id is null)
       and x.customer_id in (select id from public.customers where id = v_matriz or parent_id = v_matriz)
  loop
    update public.bitacora
       set resultado = 'ganada',
           vendedor_id = coalesce(vendedor_id, p_vendedor),
           fecha_pedido = coalesce(fecha_pedido, p_fecha),
           monto_venta = coalesce(monto_venta, p_monto),
           pausada_at = null
     where id = b.id;
    if p_nota is not null then
      insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
      values (b.id, 'estatus_cliente', left(p_nota, 2000), coalesce(auth.uid(), p_vendedor));
    end if;
  end loop;
end $$;
revoke all on function public.prospeccion_cerrar_cliente(uuid, uuid, date, numeric, text) from public, anon, authenticated;

create or replace function public.ventas_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_matriz uuid;
begin
  if TG_OP = 'INSERT' and new.tipo = 'venta' then
    select coalesce(parent_id, id) into v_matriz from public.customers where id = new.customer_id;
    -- Primero se cierra (con la nota de la factura) y luego cambia el estatus del cliente.
    perform public.prospeccion_cerrar_cliente(new.customer_id, new.vendedor_id, new.fecha, new.monto,
      'Se volvió cliente: primera venta' || coalesce(' (factura ' || new.factura || ')', ''));
    update public.customers set tipo = 'cliente' where id in (new.customer_id, v_matriz) and tipo = 'prospecto';
  end if;
  return null;
end $$;

-- Cambio de estatus a mano: queda en el historial y, si pasa a cliente, se cierra su prospeccion.
create or replace function public.customers_tipo_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo is distinct from old.tipo then
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    select b.id, 'estatus_cliente', case when new.tipo = 'cliente' then 'Prospecto convertido a cliente' else 'Cliente regresado a prospecto' end, auth.uid()
      from public.bitacora b where b.customer_id = new.id and b.archived_at is null;
    if new.tipo = 'cliente' then
      perform public.prospeccion_cerrar_cliente(new.id, null, public.local_today(), null, null);
    end if;
  end if;
  return null;
end $$;

-- Correccion: prospectos que ya son clientes (con venta registrada o marcados a mano) y siguen abiertos.
do $$
declare b record; v_matriz uuid; v record;
begin
  for b in
    select x.id, x.customer_id, x.vendedor_id from public.bitacora x
     where x.resultado = 'abierta' and x.archived_at is null
  loop
    select coalesce(parent_id, id) into v_matriz from public.customers where id = b.customer_id;
    select s.fecha, s.monto, s.factura into v from public.ventas s
     where s.tipo = 'venta' and s.cancelada_at is null
       and s.customer_id in (select id from public.customers where id = v_matriz or parent_id = v_matriz)
     order by s.fecha limit 1;
    if v.fecha is not null then
      update public.bitacora set resultado = 'ganada', fecha_pedido = coalesce(fecha_pedido, v.fecha),
             monto_venta = coalesce(monto_venta, v.monto), pausada_at = null where id = b.id;
      insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
      values (b.id, 'estatus_cliente', 'Se volvió cliente: primera venta' || coalesce(' (factura ' || v.factura || ')', ''), b.vendedor_id);
    elsif exists (select 1 from public.customers where id = v_matriz and tipo = 'cliente' and convertido_at is not null) then
      update public.bitacora set resultado = 'ganada', fecha_pedido = coalesce(fecha_pedido, public.local_today()), pausada_at = null where id = b.id;
      insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
      values (b.id, 'estatus_cliente', 'Se volvió cliente (marcado como cliente)', b.vendedor_id);
    end if;
    v := null;
  end loop;
  -- La matriz de una sucursal que ya compro tambien queda como cliente.
  update public.customers c set tipo = 'cliente'
   where c.tipo = 'prospecto' and c.parent_id is null
     and exists (select 1 from public.ventas s join public.customers k on k.id = s.customer_id
                  where k.parent_id = c.id and s.tipo = 'venta' and s.cancelada_at is null);
end $$;

commit;
