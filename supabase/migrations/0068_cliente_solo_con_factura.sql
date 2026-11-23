-- =============================================================================
-- 0068_cliente_solo_con_factura.sql   (requiere 0067 ya aplicado)
-- Regla: un prospecto pasa a cliente SOLO al subir el PDF de su factura.
--   * Se quitan los botones "Ya es cliente" y "Venta cerrada" (la base tambien lo bloquea).
--   * La venta sin factura o la partida ganada en el portal ya no lo vuelven cliente: se registra
--     la venta, pero el prospecto sigue abierto hasta que suban la factura.
--   * Unir un prospecto con su venta solo se puede con una venta registrada con factura.
--   * El comprador puede seguir corrigiendo el estatus de un cliente en su catalogo.
-- Correccion: los prospectos marcados a mano como "Venta cerrada" sin ninguna venta se reabren
-- (aparecen de nuevo en Prospeccion para que suban su factura o lo unan con su venta).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- Prospecto -> cliente: solo el sistema (al subir factura) o el comprador.
create or replace function public.customers_solo_factura() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.tipo = 'prospecto' and new.tipo = 'cliente'
     and coalesce(current_setting('esc.sistema', true), '') <> '1'
     and auth.uid() is not null and not public.is_buyer() then
    raise exception 'Un prospecto pasa a cliente solo al subir el PDF de su factura';
  end if;
  return new;
end $$;
drop trigger if exists customers_solo_factura on public.customers;
create trigger customers_solo_factura before update on public.customers
  for each row execute function public.customers_solo_factura();

-- Prospeccion "ganada" (Se volvio cliente): solo el sistema.
create or replace function public.bitacora_ganada_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resultado = 'ganada' and (TG_OP = 'INSERT' or old.resultado is distinct from 'ganada')
     and coalesce(current_setting('esc.sistema', true), '') <> '1' and auth.uid() is not null then
    raise exception 'El prospecto se cierra como cliente solo al subir el PDF de su factura';
  end if;
  return new;
end $$;
drop trigger if exists bitacora_ganada_guard on public.bitacora;
create trigger bitacora_ganada_guard before insert or update on public.bitacora
  for each row execute function public.bitacora_ganada_guard();

create or replace function public.prospeccion_cerrar_cliente(p_customer uuid, p_vendedor uuid, p_fecha date, p_monto numeric, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare v_matriz uuid; b record;
begin
  select coalesce(parent_id, id) into v_matriz from public.customers where id = p_customer;
  if v_matriz is null then return; end if;
  perform set_config('esc.sistema', '1', true);
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
  perform set_config('esc.sistema', '', true);
end $$;
revoke all on function public.prospeccion_cerrar_cliente(uuid, uuid, date, numeric, text) from public, anon, authenticated;

-- Solo la venta CON FACTURA vuelve cliente al prospecto.
create or replace function public.ventas_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_matriz uuid;
begin
  if TG_OP = 'INSERT' and new.tipo = 'venta' and new.origen = 'factura' then
    select coalesce(parent_id, id) into v_matriz from public.customers where id = new.customer_id;
    perform public.prospeccion_cerrar_cliente(new.customer_id, new.vendedor_id, new.fecha, new.monto,
      'Se volvió cliente: primera venta' || coalesce(' (factura ' || new.factura || ')', ''));
    perform set_config('esc.sistema', '1', true);
    update public.customers set tipo = 'cliente' where id in (new.customer_id, v_matriz) and tipo = 'prospecto';
    perform set_config('esc.sistema', '', true);
  end if;
  return null;
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
  if not exists (select 1 from public.ventas s join public.customers k on k.id = s.customer_id
                  where coalesce(k.parent_id, k.id) = c.id and s.origen = 'factura' and s.tipo = 'venta' and s.cancelada_at is null) then
    raise exception 'Solo se une con una venta registrada con su factura (PDF)';
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
   where coalesce(k.parent_id, k.id) = a.id and s.tipo = 'venta' and s.origen = 'factura' and s.cancelada_at is null
   order by s.fecha, s.created_at limit 1;
  perform public.prospeccion_cerrar_cliente(a.id, b.vendedor_id, coalesce(v.fecha, public.local_today()), v.monto,
    'Se volvió cliente: se unió con "' || c.nombre || '" de la factura' || coalesce(' ' || v.factura, ''));
  perform set_config('esc.sistema', '1', true);
  update public.customers set tipo = 'cliente' where id = a.id and tipo = 'prospecto';
  perform set_config('esc.sistema', '', true);
  return a.id;
end $$;
revoke all on function public.prospecto_unir_cliente(uuid, uuid) from public, anon;
grant execute on function public.prospecto_unir_cliente(uuid, uuid) to authenticated;

-- Correccion: "Venta cerrada" a mano sin ninguna venta -> se reabre.
do $$
declare b record;
begin
  for b in
    select x.id, x.vendedor_id from public.bitacora x
      join public.customers k on k.id = x.customer_id
     where x.resultado = 'ganada' and x.archived_at is null
       and not exists (select 1 from public.ventas s join public.customers z on z.id = s.customer_id
                        where coalesce(z.parent_id, z.id) = coalesce(k.parent_id, k.id) and s.tipo = 'venta' and s.cancelada_at is null)
  loop
    update public.bitacora set resultado = 'abierta' where id = b.id;
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    values (b.id, 'comentario', 'Se reabrió: para pasar a cliente hay que subir el PDF de su factura (o unirlo con su venta).', b.vendedor_id);
  end loop;
end $$;

commit;
