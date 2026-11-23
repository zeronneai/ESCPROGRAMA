-- =============================================================================
-- 0067_unir_prospecto_cliente.sql   (requiere 0066 ya aplicado)
-- Unir un prospecto con el cliente de su factura.
-- Caso: en Prospeccion lo dieron de alta con su nombre popular y la factura salio con la razon
-- social (otro nombre). Al subir la factura en Ventas diarias se creo otro cliente y el
-- prospecto se quedo abierto.
-- Desde el prospecto, el vendedor (o la jefa) elige la venta; el sistema:
--   * pasa las ventas, sucursales y demas registros de ese cliente al prospecto;
--   * le pone al prospecto la razon social, RFC y datos de la factura (se queda con su nombre
--     popular, y las siguientes facturas ya lo encuentran por RFC o razon social);
--   * lo marca como cliente y cierra su prospeccion como "Se volvio cliente", con la nota en su historial;
--   * desactiva el cliente duplicado.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.customers add column if not exists unido_a uuid references public.customers (id);

-- Al unir un prospecto con su cliente duplicado, el sistema desactiva el duplicado.
create or replace function public.customers_data_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nombre := trim(new.nombre);
  new.rfc := nullif(upper(regexp_replace(coalesce(new.rfc, ''), '[\s.-]', '', 'g')), '');
  -- El RFC de ESC no es el de un cliente: se deja vacio.
  if new.rfc is not null and (new.rfc = public.rfc_esc() or new.rfc = 'ERE060228NLA') then new.rfc := null; end if;
  new.razon_social := nullif(trim(coalesce(new.razon_social, '')), '');
  new.direccion := nullif(trim(coalesce(new.direccion, '')), '');
  new.contacto_nombre := nullif(trim(coalesce(new.contacto_nombre, '')), '');
  new.contacto_telefono := nullif(trim(coalesce(new.contacto_telefono, '')), '');
  new.contacto_correo := nullif(lower(trim(coalesce(new.contacto_correo, ''))), '');
  if new.rfc is not null and not public.rfc_valido(new.rfc) then
    raise exception 'RFC invalido: deben ser 12 o 13 caracteres (extranjero: XEXX010101000)';
  end if;
  if new.contacto_correo is not null and new.contacto_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo del cliente invalido';
  end if;
  if new.contacto_telefono is not null and length(regexp_replace(new.contacto_telefono, '\D', '', 'g')) < 7 then
    raise exception 'Telefono del cliente invalido';
  end if;
  if TG_OP = 'UPDATE' and new.activo is distinct from old.activo and not public.is_buyer()
     and coalesce(current_setting('esc.unir_cliente', true), '') <> '1' then
    raise exception 'Solo el comprador puede activar o desactivar clientes';
  end if;
  return new;
end $$;

create or replace function public.prospecto_unir_cliente(p_bitacora uuid, p_cliente uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b public.bitacora; a public.customers; c public.customers; v_dup uuid;
  v record; fk record; v_n integer; v_movidos integer := 0;
begin
  select * into b from public.bitacora where id = p_bitacora;
  if b.id is null then raise exception 'Registro no encontrado'; end if;
  if not (public.is_sales_manager() or (public.is_seller() and b.vendedor_id = auth.uid())) then
    raise exception 'Solo el vendedor del prospecto o la jefa de ventas pueden unirlo' using errcode = '42501';
  end if;
  if b.resultado <> 'abierta' or b.archived_at is not null then raise exception 'Este prospecto ya esta cerrado'; end if;

  select * into a from public.customers where id = b.customer_id;
  if a.parent_id is not null then select * into a from public.customers where id = a.parent_id; end if;
  select coalesce(parent_id, id) into v_dup from public.customers where id = p_cliente;
  if v_dup is null then raise exception 'Cliente no encontrado'; end if;
  select * into c from public.customers where id = v_dup;
  if c.id = a.id then raise exception 'Es el mismo cliente'; end if;
  if not c.activo then raise exception 'Ese cliente ya no esta activo'; end if;
  if not public.is_sales_manager() and not exists (
    select 1 from public.ventas s join public.customers k on k.id = s.customer_id
     where s.vendedor_id = auth.uid() and coalesce(k.parent_id, k.id) = c.id and s.cancelada_at is null) then
    raise exception 'Solo puedes unirlo con un cliente al que tu le vendiste';
  end if;
  if exists (select 1 from public.quote_requests where customer_id = c.id and estado = 'enviada') then
    raise exception 'Ese cliente ya tiene cotizaciones enviadas; pidele a la jefa de ventas o a compras que los unan';
  end if;

  -- Todo lo que apunta al cliente duplicado pasa al prospecto.
  for fk in
    select cl.relname as tabla, att.attname as col
      from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute att on att.attrelid = k.conrelid and att.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'public.customers'::regclass and ns.nspname = 'public'
       and array_length(k.conkey, 1) = 1 and not (cl.relname = 'customers' and att.attname = 'unido_a')
  loop
    execute format('update public.%I set %I = $1 where %I = $2', fk.tabla, fk.col, fk.col) using a.id, c.id;
    get diagnostics v_n = row_count;
    v_movidos := v_movidos + v_n;
  end loop;

  -- El duplicado se desactiva (y se le cambia el nombre para no estorbar con uno nuevo).
  perform set_config('esc.unir_cliente', '1', true);
  update public.customers
     set activo = false, unido_a = a.id, rfc = null,
         nombre = left(c.nombre, 150) || ' (unido a ' || left(a.nombre, 60) || ')'
   where id = c.id;
  perform set_config('esc.unir_cliente', '', true);

  -- El prospecto se queda con su nombre popular y toma los datos de la factura que le falten.
  update public.customers
     set razon_social = coalesce(razon_social, c.razon_social, c.nombre),
         rfc = coalesce(rfc, c.rfc),
         direccion = coalesce(direccion, c.direccion),
         contacto_telefono = coalesce(contacto_telefono, c.contacto_telefono),
         contacto_correo = coalesce(contacto_correo, c.contacto_correo),
         contacto_nombre = coalesce(contacto_nombre, c.contacto_nombre)
   where id = a.id;

  -- Cierra la prospeccion con la primera venta y la deja anotada.
  select s.fecha, s.monto, s.factura into v from public.ventas s join public.customers k on k.id = s.customer_id
   where coalesce(k.parent_id, k.id) = a.id and s.tipo = 'venta' and s.cancelada_at is null
   order by s.fecha, s.created_at limit 1;
  perform public.prospeccion_cerrar_cliente(a.id, b.vendedor_id, coalesce(v.fecha, public.local_today()), v.monto,
    'Se volvió cliente: se unió con "' || c.nombre || '" de la factura' || coalesce(' ' || v.factura, ''));
  update public.customers set tipo = 'cliente' where id = a.id and tipo = 'prospecto';
  return a.id;
end $$;
revoke all on function public.prospecto_unir_cliente(uuid, uuid) from public, anon;
grant execute on function public.prospecto_unir_cliente(uuid, uuid) to authenticated;

commit;
