-- =============================================================================
-- 0023_demo.sql   (requiere 0022 ya aplicado)
-- Que hace:
--   * DATOS DE DEMOSTRACION: el comprador los carga desde Configuracion > Demostracion, por seccion o todo
--     junto: clientes y prospectos, solicitudes de cotizacion, bitacora de ventas/prospeccion (con
--     articulos), quejas y acciones correctivas, consumo interno y guias.
--   * Todo se crea con los usuarios reales (vendedores, jefa de ventas, coordinador ISO, Marketplaces y el
--     comprador que lo carga), como si ellos lo hubieran capturado: pasa por las mismas reglas y avisos.
--   * Los clientes de demostracion llevan "(Demo)" en el nombre.
--   * Para quitarlo todo antes de arrancar en serio: supabase/borrar-datos-de-prueba.sql.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

create table if not exists public.demo_cargas (
  seccion text primary key,
  detalle text,
  cargado_por uuid references public.profiles (id),
  cargado_at timestamptz not null default now()
);
alter table public.demo_cargas enable row level security;
revoke all on public.demo_cargas from anon, authenticated;
grant select on public.demo_cargas to authenticated;
drop policy if exists demo_cargas_select on public.demo_cargas;
create policy demo_cargas_select on public.demo_cargas for select to authenticated using (public.is_buyer());

-- Actua como otro usuario dentro de la carga (para que reglas, autores y avisos queden como si el lo hiciera).
create or replace function public.demo_as(p_user uuid) returns void
language plpgsql set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
revoke all on function public.demo_as(uuid) from public, anon, authenticated;

create or replace function public.demo_user(p_rol public.user_role, p_n integer default 1) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where rol = p_rol and activo and not must_change_password
   order by created_at offset greatest(p_n - 1, 0) limit 1;
$$;
revoke all on function public.demo_user(public.user_role, integer) from public, anon, authenticated;

-- Vendedor numero n (se reparte entre los que haya).
create or replace function public.demo_seller(p_n integer) returns uuid
language sql stable security definer set search_path = public as $$
  with s as (select id, row_number() over (order by created_at) - 1 as k, count(*) over () as c
               from public.profiles where rol = 'vendedor' and activo and not must_change_password)
  select id from s where k = (p_n % c);
$$;
revoke all on function public.demo_seller(integer) from public, anon, authenticated;

create or replace function public.demo_customer(p_nombre text) returns uuid
language sql stable security definer set search_path = public as $$ select id from public.customers where nombre = p_nombre limit 1; $$;
revoke all on function public.demo_customer(text) from public, anon, authenticated;

create or replace function public.demo_articulo(p_like text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.articulos where vendible and busqueda like '%' || p_like || '%' order by clave limit 1;
$$;
revoke all on function public.demo_articulo(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Secciones
-- ---------------------------------------------------------------------------
create or replace function public.demo_clientes() returns text
language plpgsql security definer set search_path = public as $$
declare c record; n integer := 0; k integer := 0;
begin
  for c in select * from (values
    ('Manufacturas del Norte (Demo)', 'cliente', 'Manufactura electrónica', 'Chihuahua', 'MDN010203AB1', 'Av. Industrial 1450, Parque Industrial Norte, Cd. Juárez', 'Laura Méndez', '656 100 2030', 'compras@mdnorte-demo.mx'),
    ('Autopartes Bravo (Demo)', 'cliente', 'Automotriz', 'Chihuahua', 'ABR040506CD2', 'Blvd. Ortiz Mena 3300, Chihuahua', 'Jorge Ríos', '614 200 3040', 'jrios@bravo-demo.mx'),
    ('Hospital Santa Clara (Demo)', 'cliente', 'Salud', 'Chihuahua', 'HSC990101EF3', 'Calle Rosales 120, Centro, Chihuahua', 'Dra. Ana Lucía Paz', '614 300 4050', 'almacen@santaclara-demo.mx'),
    ('Alimentos La Sierra (Demo)', 'cliente', 'Alimentos', 'Durango', 'ALS050607GH4', 'Carretera a Mazatlán km 4, Durango', 'Pedro Salas', '618 400 5060', 'psalas@lasierra-demo.mx'),
    ('Electro Componentes del Bajío (Demo)', 'prospecto', 'Electrónica', 'Guanajuato', null, 'Parque Industrial Castro del Rio, Irapuato', 'Sofia Aguirre', '462 500 6070', null),
    ('Plásticos Industriales Monterrey (Demo)', 'prospecto', 'Plásticos', 'Nuevo León', null, null, 'Mario Treviño', '81 6000 7080', 'mtrevino@pim-demo.mx'),
    ('Laboratorios Vida (Demo)', 'prospecto', 'Farmacéutica', 'Jalisco', null, null, 'Rebeca Orozco', '33 7000 8090', null),
    ('Ensambles Aeroespaciales (Demo)', 'prospecto', 'Aeroespacial', 'Chihuahua', 'EAE080910IJ5', 'Av. de las Industrias 8800, Chihuahua', 'Carlos Ponce', '614 800 9010', 'cponce@ensambles-demo.mx')
  ) as t(nombre, tipo, giro, estado_geo, rfc, direccion, contacto, tel, correo) loop
    k := k + 1;
    if public.demo_customer(c.nombre) is null then
      perform public.demo_as(public.demo_seller(k));
      insert into public.customers (nombre, tipo, giro, estado_geo, rfc, direccion, contacto_nombre, contacto_telefono, contacto_correo, created_by)
      values (c.nombre, c.tipo::public.customer_kind, c.giro, c.estado_geo, c.rfc, c.direccion, c.contacto, c.tel, c.correo, auth.uid());
      n := n + 1;
    end if;
  end loop;
  return n || ' clientes y prospectos';
end $$;

create or replace function public.demo_cotizaciones(p_buyer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  f public.pricing_config; v_factors jsonb; s record; v_req uuid; v_item uuid; v_seller uuid; n integer := 0; k integer := 0;
  v_costo numeric; v_base numeric; v_art record;
begin
  select * into f from public.pricing_config order by id desc limit 1;
  v_factors := jsonb_build_object('no_shipping_markup', f.no_shipping_markup, 'p1', f.p1, 'p2', f.p2, 'p3', f.p3, 'p4', f.p4, 'p5', f.p5);
  -- escenario: 1 ganada y otra enviada; 2 cotizada por enviar; 3 con compras; 4 una no encontrada y otra perdida
  for s in select * from (values
    (1, 'Manufacturas del Norte (Demo)', 'guante de nitrilo', 'wipe', 40, 25),
    (2, 'Autopartes Bravo (Demo)', 'bata', 'cubrebocas', 30, 20),
    (3, 'Hospital Santa Clara (Demo)', 'gorro', 'cubrezapatos', 50, 60),
    (4, 'Alimentos La Sierra (Demo)', 'mandil', 'guante de latex', 25, 10)
  ) as t(escenario, cliente, a1, a2, q1, q2) loop
    k := k + 1;
    v_seller := public.demo_seller(k);
    perform public.demo_as(v_seller);
    v_req := gen_random_uuid();
    insert into public.quote_requests (id, vendedor_id, customer_id, notas) values (v_req, v_seller, public.demo_customer(s.cliente), 'Solicitud de demostración');
    for v_art in select coalesce(a.nombre, initcap(x.a)) as nombre, x.q, x.pos from (values (s.a1, s.q1, 1), (s.a2, s.q2, 2)) as x(a, q, pos)
                 left join lateral (select nombre from public.articulos where vendible and busqueda like '%' || x.a || '%' order by clave limit 1) a on true loop
      insert into public.quote_items (request_id, posicion, producto, descripcion, cantidad, unidad)
      values (v_req, v_art.pos, left(v_art.nombre, 200), 'Para uso en planta, mismo producto que compran actualmente', v_art.q, 'caja')
      returning id into v_item;
      insert into public.item_references (item_id, tipo, url) values (v_item, 'link', 'https://elsauz.com');
    end loop;
    update public.quote_requests set estado = 'enviada', due_at = now() + interval '2 days' where id = v_req;
    n := n + 1;
    if s.escenario = 3 then continue; end if;
    -- Compras cotiza
    perform public.demo_as(p_buyer);
    for v_item in select id from public.quote_items where request_id = v_req order by posicion loop
      if s.escenario = 4 and v_item = (select id from public.quote_items where request_id = v_req order by posicion limit 1) then
        perform public.respond_item(v_item, 'not_found', jsonb_build_object('nota', 'El proveedor lo descontinuó; se ofrece alternativo en otra solicitud', 'response_hours', 3));
        continue;
      end if;
      v_costo := 180 + (random() * 400)::int;
      v_base := v_costo * (1 + f.no_shipping_markup);
      perform public.respond_item(v_item, 'quote', jsonb_build_object(
        'costo', v_costo, 'envio', null, 'moneda', 'MXN', 'factors', v_factors,
        'prices', jsonb_build_object('p1', round(v_base * f.p1, 2), 'p2', round(v_base * f.p2, 2), 'p3', round(v_base * f.p3, 2),
                                     'p4', round(v_base * f.p4, 2), 'p5', round(v_base * f.p5, 2)),
        'entrega', jsonb_build_object('dias', 5, 'tipo', 'habiles'), 'compra_min', jsonb_build_object('cantidad', 1, 'unidad', 'caja'),
        'proveedor', 'Proveedor demo', 'nota', null, 'response_hours', 4));
    end loop;
    if s.escenario = 2 then continue; end if;
    -- El vendedor la envia al cliente y registra el resultado
    perform public.demo_as(v_seller);
    for v_item in select id from public.quote_items where request_id = v_req and estado = 'cotizada' order by posicion loop
      perform public.mark_item_dispatched(v_item, 2);
      if s.escenario = 1 and v_item = (select id from public.quote_items where request_id = v_req order by posicion limit 1) then
        perform public.set_item_outcome(v_item, 'ganada');
      elsif s.escenario = 4 then
        perform public.set_item_outcome(v_item, 'perdida', 'precio_alto');
      end if;
    end loop;
    update public.bitacora set fecha_cotizacion = coalesce(fecha_cotizacion, public.local_today()) where request_id = v_req;
  end loop;
  return n || ' solicitudes de cotizacion';
end $$;

create or replace function public.demo_bitacora() returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seller uuid; n integer := 0; d date := public.local_today(); b record; v_c uuid;
begin
  -- Clientes con solicitud: avanzar etapas de venta.
  for b in select bi.id, bi.vendedor_id, c.nombre from public.bitacora bi join public.customers c on c.id = bi.customer_id
            where c.nombre like '%(Demo)' and bi.origen = 'portal' loop
    perform public.demo_as(b.vendedor_id);
    if b.nombre like 'Manufacturas%' then
      update public.bitacora set fecha_catalogo = d - 30, monto_venta = 48500, facturacion = 'credito', fecha_factura = d - 1,
             proximo_seguimiento = d + 2, comentarios = 'Pidió factura a 30 días' where id = b.id;
    elsif b.nombre like 'Autopartes%' then
      update public.bitacora set fecha_catalogo = d - 15, proximo_seguimiento = d where id = b.id;
    elsif b.nombre like 'Hospital%' then
      update public.bitacora set fecha_catalogo = d - 8, muestra_no_aplica = true, proximo_seguimiento = d + 3 where id = b.id;
    elsif b.nombre like 'Alimentos%' then
      update public.bitacora set resultado = 'perdida', motivo_perdida = 'Precio alto' where id = b.id;
    end if;
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by) values (b.id, 'comentario', 'Llamada de seguimiento con compras del cliente', auth.uid());
    insert into public.bitacora_articulos (bitacora_id, articulo_id, cantidad)
    select b.id, a.id, 10 from public.articulos a
     where a.vendible and a.nombre in (select producto from public.quote_items qi join public.bitacora x on x.request_id = qi.request_id where x.id = b.id)
    on conflict do nothing;
    n := n + 1;
  end loop;

  -- Venta ya entregada y cobrada a medias, con cartera vencida.
  v_seller := public.demo_seller(0);
  perform public.demo_as(v_seller);
  insert into public.bitacora (vendedor_id, customer_id, necesidad, fecha_catalogo, muestra_no_aplica, fecha_pedido, monto_venta, facturacion,
                               fecha_factura, fecha_entrega, porcentaje_cobranza, cartera_dias_vencidos, cartera_monto, created_by)
  values (v_seller, public.demo_customer('Autopartes Bravo (Demo)'), 'Batas ESD para línea de ensamble', d - 60, true, d - 45, 32000, 'credito',
          d - 44, d - 40, 50, 12, 16000, v_seller)
  returning id into v_id;
  insert into public.bitacora_articulos (bitacora_id, articulo_id, cantidad) select v_id, a, 80 from public.demo_articulo('bata') a where a is not null;
  n := n + 1;

  -- Prospeccion
  for b in select * from (values
    (1, 'Electro Componentes del Bajío (Demo)', 'guantes y dedales para línea SMT', 'guante de nitrilo', 'dedal', 12, 5),
    (2, 'Plásticos Industriales Monterrey (Demo)', 'tapetes adhesivos para cuarto limpio', 'tapete', 'cubrezapatos', 6, -1),
    (3, 'Laboratorios Vida (Demo)', 'batas y cofias desechables', 'bata', 'gorro', 3, 1),
    (4, 'Ensambles Aeroespaciales (Demo)', 'wipes para limpieza de piezas', 'wipe', 'guante', 20, 0)
  ) as t(k, cliente, necesidad, a1, a2, hace, seg) loop
    v_seller := public.demo_seller(b.k);
    perform public.demo_as(v_seller);
    v_c := public.demo_customer(b.cliente);
    insert into public.bitacora (vendedor_id, customer_id, necesidad, fecha_catalogo, fecha_muestra, proximo_seguimiento, created_by)
    values (v_seller, v_c, b.necesidad, d - b.hace, case when b.k in (1, 4) then d - b.hace + 3 end, d + b.seg, v_seller)
    returning id into v_id;
    insert into public.bitacora_articulos (bitacora_id, articulo_id) select v_id, a from public.demo_articulo(b.a1) a where a is not null on conflict do nothing;
    insert into public.bitacora_articulos (bitacora_id, articulo_id) select v_id, a from public.demo_articulo(b.a2) a where a is not null on conflict do nothing;
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    values (v_id, 'comentario', 'Visita: le dejé catálogo y muestras, quedó de revisar con su gerente', v_seller);
    n := n + 1;
    -- Ensambles ya compro: se marca cliente (cuenta como prospecto convertido).
    if b.k = 4 then
      update public.bitacora set fecha_pedido = d - 2, monto_venta = 21800 where id = v_id;
      update public.customers set tipo = 'cliente' where id = v_c;
    end if;
  end loop;

  -- Prospecto que llego del sitio web, sin vendedor.
  perform public.demo_as(null);
  insert into public.customers (nombre, tipo, giro, estado_geo, contacto_nombre, contacto_telefono, contacto_correo)
  select 'Clínica Dental Sonrisa (Demo)', 'prospecto', 'Salud', 'Chihuahua', 'Marcela Gil', '614 111 2233', 'contacto@sonrisa-demo.mx'
   where public.demo_customer('Clínica Dental Sonrisa (Demo)') is null;
  insert into public.bitacora (customer_id, necesidad, comentarios, origen)
  values (public.demo_customer('Clínica Dental Sonrisa (Demo)'), 'Cubrebocas y guantes de nitrilo para consultorio', 'Mensaje del formulario: Cotización mensual', 'sitio_web');
  return n + 1 || ' registros de bitacora';
end $$;

create or replace function public.demo_calidad() returns text
language plpgsql security definer set search_path = public as $$
declare v_iso uuid := public.demo_user('coordinador_iso'); q1 uuid; q2 uuid; q3 uuid; v_s uuid; r text := '';
begin
  perform public.demo_as(public.demo_seller(0));
  insert into public.quejas (via_recepcion, customer_id, cliente_nombre, contacto_nombre, contacto_medio, referencia, descripcion)
  values ('telefono', public.demo_customer('Manufacturas del Norte (Demo)'), 'Manufacturas del Norte (Demo)', 'Laura Méndez', '656 100 2030',
          'Factura A-1180', 'Llegaron 3 cajas de guantes talla M en lugar de talla L. El cliente pide el cambio esta semana.')
  returning id into q1;
  perform public.demo_as(public.demo_seller(1));
  insert into public.quejas (via_recepcion, customer_id, cliente_nombre, contacto_nombre, contacto_medio, referencia, descripcion)
  values ('correo', public.demo_customer('Autopartes Bravo (Demo)'), 'Autopartes Bravo (Demo)', 'Jorge Ríos', 'jrios@bravo-demo.mx',
          'OC 45122', 'La entrega llego 5 días después de lo prometido y la linea se detuvo medio turno.')
  returning id into q2;
  insert into public.quejas (via_recepcion, customer_id, cliente_nombre, contacto_nombre, referencia, descripcion)
  values ('whatsapp', public.demo_customer('Hospital Santa Clara (Demo)'), 'Hospital Santa Clara (Demo)', 'Dra. Ana Lucía Paz',
          'Factura A-1201', 'Dos cajas de batas llegaron con el empaque roto.')
  returning id into q3;
  insert into public.calidad_eventos (queja_id, tipo, nota) values (q2, 'comentario', 'El cliente mandó fotos del acuse de recibo con la fecha');
  r := '3 quejas';
  if v_iso is not null then
    perform public.demo_as(v_iso);
    update public.quejas set estado = 'en_analisis' where id = q1;
    update public.quejas set estado = 'cerrada', solucion = 'Se repusieron las 2 cajas sin costo y se revisó el empaque con el proveedor.' where id = q3;
    insert into public.acciones_correctivas (solicitante, codigo_control, clausula, fuente, queja_id, descripcion, equipo, correccion, contencion,
      consecuencia, objetivo, causas, causa_raiz, procesos_afectados, actualizar_riesgos, plan, plan_crea_riesgo, estado)
    values (public.my_name(), 'ESC-SGC-FR-001', '8.5.1', 'queja_cliente', q2, 'Entrega fuera del tiempo prometido al cliente.',
      jsonb_build_array(jsonb_build_object('nombre', public.my_name(), 'puesto', 'Coordinador ISO'), jsonb_build_object('nombre', 'Compras', 'puesto', 'Comprador')),
      'Se envió el material por paquetería express sin costo', 'Revisar los pedidos abiertos con el mismo proveedor',
      'Paro de línea del cliente', 'Cumplir 100% las fechas de entrega comprometidas',
      jsonb_build_object('metodo', 'No se confirma la fecha con el proveedor antes de prometerla', 'mano_obra', 'Se prometió fecha sin consultar a compras'),
      'No existe confirmación de fecha de entrega con el proveedor antes de cotizar', 'Ventas, compras', true,
      jsonb_build_array(
        jsonb_build_object('actividad', 'Agregar confirmación de fecha del proveedor en la cotización', 'responsable', 'Compras', 'fecha', to_char(public.local_today() + 7, 'YYYY-MM-DD'), 'reprogramacion', '', 'hecho', true),
        jsonb_build_object('actividad', 'Capacitar a vendedores en tiempos de entrega', 'responsable', 'Jefa de ventas', 'fecha', to_char(public.local_today() + 14, 'YYYY-MM-DD'), 'reprogramacion', '', 'hecho', false)),
      false, 'en_proceso')
    returning id into v_s;
    insert into public.calidad_eventos (sac_id, tipo, nota) values (v_s, 'comentario', 'Primera actividad completada');
    r := r || ' y 1 accion correctiva';
  else
    r := r || ' (sin coordinador ISO activo no se crean acciones correctivas)';
  end if;
  return r;
end $$;

create or replace function public.demo_consumo(p_buyer uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_jefa uuid := public.demo_user('jefe_ventas'); c1 uuid; c2 uuid; c3 uuid; c4 uuid;
begin
  perform public.demo_as(public.demo_seller(0));
  insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, unidad, motivo)
  values ('producto', 'papeleria', 'Hojas tamaño carta', 2, 'paquete', 'Se acabaron, se usan para imprimir cotizaciones') returning id into c1;
  insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, unidad, motivo, urgente)
  values ('servicio', 'vehiculo', 'Afinación y cambio de aceite camioneta de reparto', 1, 'servicio', 'Ya le toca por kilometraje', true) returning id into c2;
  perform public.demo_as(public.demo_seller(1));
  insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, unidad, motivo)
  values ('producto', 'limpieza', 'Cloro y jabón para trastes', 4, 'pieza', 'Limpieza de la oficina') returning id into c3;
  insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, unidad, motivo)
  values ('producto', 'cafeteria', 'Café molido', 3, 'kg', 'Para clientes que visitan la oficina') returning id into c4;
  if v_jefa is null then
    return '4 solicitudes por aprobar (sin jefa de ventas activa no se aprueban)';
  end if;
  perform public.demo_as(v_jefa);
  perform public.consumo_aprobar(c2, true, 'Adelante');
  perform public.consumo_aprobar(c3, true, null);
  perform public.consumo_aprobar(c4, true, null);
  perform public.demo_as(p_buyer);
  perform public.consumo_avance(c2, 'en_proceso', public.local_today() + 3, 'Agendado en Taller Ruiz');
  perform public.consumo_avance(c4, 'en_proceso', null, 'Pedido a Costco');
  perform public.consumo_avance(c4, 'completada', null, null);
  return '4 solicitudes (1 por aprobar, 1 aprobada, 1 agendada y 1 recibida)';
end $$;

create or replace function public.demo_guias() returns text
language plpgsql security definer set search_path = public as $$
declare v_mkt uuid := public.demo_user('marketplaces'); g1 uuid; g2 uuid; g3 uuid; g4 uuid;
begin
  perform public.demo_as(public.demo_seller(0));
  insert into public.guias (factura, destinatario, paqueteria, servicio, customer_id, contacto_nombre, telefono, correo, calle_numero, colonia, cp, ciudad,
                            estado_geo, bultos, peso_kg, largo_cm, ancho_cm, alto_cm, contenido, valor_declarado, urgente)
  values ('A-1234', 'Manufacturas del Norte (Demo)', 'DHL', 'dia_siguiente', public.demo_customer('Manufacturas del Norte (Demo)'), 'Laura Méndez',
          '656 100 2030', 'compras@mdnorte-demo.mx', 'Av. Industrial 1450', 'Parque Industrial Norte', '32690', 'Cd. Juárez', 'Chihuahua',
          2, 12.5, 40, 30, 30, 'Guantes de nitrilo', 8500, true) returning id into g1;
  insert into public.guias (factura, destinatario, paqueteria, telefono, calle_numero, colonia, cp, ciudad, estado_geo, bultos, peso_kg, contenido)
  values ('A-1240', 'Alimentos La Sierra (Demo)', 'Estafeta', '618 400 5060', 'Carretera a Mazatlán km 4', 'Industrial', '34208', 'Durango', 'Durango', 1, 6, 'Mandiles y cofias')
  returning id into g2;
  perform public.demo_as(public.demo_seller(1));
  insert into public.guias (factura, destinatario, paqueteria, telefono, calle_numero, cp, ciudad, estado_geo, bultos, peso_kg, contenido)
  values ('B-88', 'Hospital Santa Clara (Demo)', 'Paquetexpress', '614 300 4050', 'Calle Rosales 120', '31000', 'Chihuahua', 'Chihuahua', 3, 20, 'Batas desechables')
  returning id into g3;
  insert into public.guias (factura, destinatario, paqueteria, telefono, calle_numero, cp, ciudad, estado_geo, bultos, peso_kg)
  values ('B-91', 'Autopartes Bravo (Demo)', 'FedEx', '614 200 3040', 'Blvd. Ortiz Mena 3300', '31200', 'Chihuahua', 'Chihuahua', 1, 4)
  returning id into g4;
  -- Una lleva mas de 24 horas y otra mas de 4 (para ver las alertas).
  update public.guias set solicitada_at = now() - interval '26 hours', created_at = now() - interval '26 hours' where id = g1;
  update public.guias set solicitada_at = now() - interval '5 hours', created_at = now() - interval '5 hours' where id = g3;
  if v_mkt is null then
    return '4 guias solicitadas (sin usuario de Marketplaces activo no se atienden)';
  end if;
  perform public.demo_as(v_mkt);
  perform public.guia_mover(g1, 'en_proceso');
  perform public.guia_mover(g2, 'requiere_datos', 'Falta el número exterior y una referencia del domicilio.');
  perform public.demo_as(public.demo_seller(0));
  insert into public.guia_eventos (guia_id, tipo, nota) values (g1, 'comentario', 'Es urgente, el cliente lo necesita mañana temprano');
  return '4 guias (1 generandose con mas de 24 h, 1 con datos faltantes, 2 por atender)';
end $$;

-- Punto de entrada (solo comprador). Seccion: clientes, cotizaciones, bitacora, calidad, consumo, guias o todo.
create or replace function public.demo_cargar(p_seccion text) returns text
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true); v_out text := ''; s text;
  secciones text[] := case when p_seccion = 'todo' then array['clientes', 'cotizaciones', 'bitacora', 'calidad', 'consumo', 'guias']
                           else array[p_seccion] end;
begin
  if not public.is_buyer() then raise exception 'Solo el comprador carga la demostracion' using errcode = '42501'; end if;
  if not (secciones <@ array['clientes', 'cotizaciones', 'bitacora', 'calidad', 'consumo', 'guias']) then raise exception 'Seccion invalida'; end if;
  if public.demo_seller(0) is null then
    raise exception 'Primero crea al menos un usuario Vendedor y entra una vez con el (para que cambie su contrasena temporal)';
  end if;
  foreach s in array secciones loop
    if exists (select 1 from public.demo_cargas where seccion = s) then
      v_out := v_out || s || ': ya estaba cargada. ';
      continue;
    end if;
    -- Las secciones que usan clientes los crean si faltan.
    if s <> 'clientes' and not exists (select 1 from public.demo_cargas where seccion = 'clientes') then
      perform public.demo_clientes();
      insert into public.demo_cargas (seccion, detalle, cargado_por) values ('clientes', '8 clientes y prospectos', v_me);
    end if;
    -- La bitacora se apoya en las solicitudes (se crean solas al enviarlas).
    if s = 'bitacora' and not exists (select 1 from public.demo_cargas where seccion = 'cotizaciones') then
      insert into public.demo_cargas (seccion, detalle, cargado_por) values ('cotizaciones', public.demo_cotizaciones(v_me), v_me);
    end if;
    insert into public.demo_cargas (seccion, detalle, cargado_por)
    values (s, case s when 'clientes' then public.demo_clientes() when 'cotizaciones' then public.demo_cotizaciones(v_me)
                      when 'bitacora' then public.demo_bitacora() when 'calidad' then public.demo_calidad()
                      when 'consumo' then public.demo_consumo(v_me) else public.demo_guias() end, v_me)
    returning v_out || s || ': ' || detalle || '. ' into v_out;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform public.write_audit('demo_cargada', 'demo_cargas', p_seccion, null, jsonb_build_object('resultado', v_out));
  return trim(v_out);
end $$;

revoke all on function public.demo_clientes(), public.demo_cotizaciones(uuid), public.demo_bitacora(), public.demo_calidad(),
  public.demo_consumo(uuid), public.demo_guias() from public, anon, authenticated;
revoke all on function public.demo_cargar(text) from public, anon;
grant execute on function public.demo_cargar(text) to authenticated;

commit;

-- VERIFICACION:
--   select proname from pg_proc where proname = 'demo_cargar';   -- 1 fila
