-- =============================================================================
-- 0024_ventas_diarias.sql   (requiere 0023 ya aplicado)
-- Que hace:
--   * VENTAS DIARIAS (separado de la prospeccion): un renglon sencillo por venta a clientes: fecha, cliente,
--     articulos y cantidad, pedido/OC, factura, monto, contado o credito (dias), entrega y cobranza.
--     La cartera vencida se calcula sola: credito + fecha + dias de credito, menos lo cobrado.
--   * Al marcar Ganada una partida del portal, la venta se registra sola (el vendedor la completa).
--   * Si el que compra era prospecto, pasa a cliente (cuenta como convertido) y su seguimiento de
--     prospeccion se cierra como ganado.
--   * PROSPECCION: al enviar una solicitud, el seguimiento por etapas se crea solo si el cliente es prospecto.
--   * Las ventas no se borran: se cancelan (queda registro).
--   * GUIAS: las paqueterias son Paquete Express, Estafeta, Tinypack, Porteo, DHL u Otra.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null default auth.uid() references public.profiles (id),
  customer_id uuid not null references public.customers (id),
  fecha date not null default public.local_today(),
  request_id uuid references public.quote_requests (id),
  pedido text check (pedido is null or length(pedido) <= 80),
  factura text check (factura is null or length(factura) <= 80),
  monto numeric(14, 2) check (monto is null or monto >= 0),
  moneda public.currency not null default 'MXN',
  pago text not null default 'contado' check (pago in ('contado', 'credito')),
  dias_credito integer check (dias_credito is null or dias_credito between 1 and 365),
  vence date generated always as (case when pago = 'credito' then fecha + coalesce(dias_credito, 30) end) stored,
  entregado boolean not null default false,
  fecha_entrega date,
  porcentaje_cobrado numeric(5, 2) not null default 0 check (porcentaje_cobrado between 0 and 100),
  fecha_cobro date,
  comentarios text check (comentarios is null or length(comentarios) <= 2000),
  origen text not null default 'vendedor' check (origen in ('vendedor', 'portal')),
  cancelada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ventas_vendedor_idx on public.ventas (vendedor_id, fecha desc);
create index ventas_customer_idx on public.ventas (customer_id);
create index ventas_request_idx on public.ventas (request_id) where request_id is not null;

create table public.venta_lineas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas (id),
  articulo_id uuid references public.articulos (id),
  descripcion text not null check (length(trim(descripcion)) between 1 and 300),
  cantidad numeric(12, 2) check (cantidad is null or cantidad > 0),
  created_at timestamptz not null default now()
);
create index venta_lineas_venta_idx on public.venta_lineas (venta_id);
create index venta_lineas_articulo_idx on public.venta_lineas (articulo_id) where articulo_id is not null;

create or replace function public.can_read_venta(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or exists (
    select 1 from public.ventas v where v.id = p_id and v.vendedor_id = auth.uid());
$$;
create or replace function public.can_write_venta(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() and exists (
    select 1 from public.ventas v where v.id = p_id and v.vendedor_id = auth.uid() and v.cancelada_at is null);
$$;
grant execute on function public.can_read_venta(uuid), public.can_write_venta(uuid) to authenticated;

-- Reglas: el cliente pasa a cliente si era prospecto; la prospeccion abierta se cierra como ganada.
create or replace function public.ventas_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if public.is_seller() then new.vendedor_id := auth.uid(); end if;
  else
    new.vendedor_id := old.vendedor_id;
    new.origen := old.origen;
    if old.cancelada_at is not null and new.cancelada_at is not null then
      raise exception 'Esta venta esta cancelada';
    end if;
  end if;
  if new.pago = 'contado' then new.dias_credito := null; end if;
  if new.pago = 'credito' and new.dias_credito is null then new.dias_credito := 30; end if;
  if not new.entregado then new.fecha_entrega := null;
  elsif new.fecha_entrega is null then new.fecha_entrega := public.local_today(); end if;
  if new.porcentaje_cobrado >= 100 and new.fecha_cobro is null then new.fecha_cobro := public.local_today(); end if;
  if new.porcentaje_cobrado < 100 then new.fecha_cobro := null; end if;
  return new;
end $$;
create trigger ventas_before before insert or update on public.ventas
  for each row execute function public.ventas_before();

create or replace function public.ventas_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    update public.customers set tipo = 'cliente' where id = new.customer_id and tipo = 'prospecto';
    update public.bitacora
       set resultado = 'ganada', fecha_pedido = coalesce(fecha_pedido, new.fecha),
           monto_venta = coalesce(monto_venta, new.monto)
     where customer_id = new.customer_id and vendedor_id = new.vendedor_id and resultado = 'abierta' and archived_at is null;
  end if;
  return null;
end $$;
create trigger ventas_after after insert on public.ventas
  for each row execute function public.ventas_after();

create trigger ventas_updated before update on public.ventas for each row execute function public.set_updated_at();
create trigger ventas_no_delete before delete on public.ventas for each row execute function public.forbid_mutation();
create trigger ventas_audit after insert or update on public.ventas for each row execute function public.audit_row();
create trigger venta_lineas_audit after insert or update or delete on public.venta_lineas for each row execute function public.audit_row();

alter table public.ventas enable row level security;
alter table public.venta_lineas enable row level security;
revoke all on public.ventas, public.venta_lineas from anon, authenticated;
grant select on public.ventas, public.venta_lineas to authenticated;
grant insert (id, customer_id, fecha, request_id, pedido, factura, monto, moneda, pago, dias_credito, entregado, fecha_entrega,
              porcentaje_cobrado, comentarios) on public.ventas to authenticated;
grant update (customer_id, fecha, request_id, pedido, factura, monto, moneda, pago, dias_credito, entregado, fecha_entrega,
              porcentaje_cobrado, comentarios, cancelada_at) on public.ventas to authenticated;
grant insert (id, venta_id, articulo_id, descripcion, cantidad), delete on public.venta_lineas to authenticated;
grant update (cantidad, descripcion) on public.venta_lineas to authenticated;

create policy ventas_select on public.ventas for select to authenticated
  using (vendedor_id = auth.uid() or public.is_buyer() or public.is_sales_reader());
create policy ventas_insert on public.ventas for insert to authenticated
  with check (public.is_seller());
create policy ventas_update on public.ventas for update to authenticated
  using (public.is_seller() and vendedor_id = auth.uid() and cancelada_at is null)
  with check (public.is_seller() and vendedor_id = auth.uid());
create policy venta_lineas_select on public.venta_lineas for select to authenticated using (public.can_read_venta(venta_id));
create policy venta_lineas_insert on public.venta_lineas for insert to authenticated with check (public.can_write_venta(venta_id));
create policy venta_lineas_update on public.venta_lineas for update to authenticated
  using (public.can_write_venta(venta_id)) with check (public.can_write_venta(venta_id));
create policy venta_lineas_delete on public.venta_lineas for delete to authenticated using (public.can_write_venta(venta_id));

-- ---------------------------------------------------------------------------
-- Desde el portal
-- ---------------------------------------------------------------------------
-- Prospeccion: solo cuando el cliente es prospecto.
create or replace function public.bitacora_on_request_submit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_need text;
begin
  if not (old.estado = 'borrador' and new.estado = 'enviada') then return null; end if;
  if not exists (select 1 from public.customers where id = new.customer_id and tipo = 'prospecto') then return null; end if;
  select string_agg(i.producto, ', ' order by i.posicion) into v_need from public.quote_items i where i.request_id = new.id;
  select id into v_id from public.bitacora
   where vendedor_id = new.vendedor_id and customer_id = new.customer_id and request_id is null
     and resultado = 'abierta' and archived_at is null
   order by created_at desc limit 1;
  if v_id is not null then
    update public.bitacora
       set request_id = new.id,
           fecha_solicitud_compras = coalesce(fecha_solicitud_compras, public.local_today()),
           necesidad = coalesce(necesidad, left(v_need, 1000))
     where id = v_id;
  else
    insert into public.bitacora (vendedor_id, customer_id, request_id, necesidad, fecha_solicitud_compras, origen, created_by)
    values (new.vendedor_id, new.customer_id, new.id, left(v_need, 1000), public.local_today(), 'portal', new.vendedor_id);
  end if;
  return null;
end $$;

-- Partida Ganada: se suma a la venta del dia de esa solicitud (o se crea).
create or replace function public.ventas_on_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; i public.quote_items; d public.item_dispatch; q public.item_quotes;
  v_qty numeric; v_monto numeric; v_venta uuid;
begin
  if new.resultado <> 'ganada' or (TG_OP = 'UPDATE' and old.resultado = 'ganada') then return null; end if;
  select * into i from public.quote_items where id = new.item_id;
  select * into r from public.quote_requests where id = i.request_id;
  select * into d from public.item_dispatch where item_id = new.item_id and quote_version = new.quote_version;
  select * into q from public.item_quotes where item_id = new.item_id and version = new.quote_version;
  v_qty := coalesce(new.cantidad_final, i.cantidad);
  v_monto := case when d.valor is not null and v_qty is not null then round(d.valor * v_qty, 2) end;
  select id into v_venta from public.ventas
   where request_id = r.id and origen = 'portal' and fecha = public.local_today() and cancelada_at is null
   order by created_at limit 1;
  if v_venta is null then
    insert into public.ventas (vendedor_id, customer_id, request_id, monto, moneda, origen, comentarios)
    values (r.vendedor_id, r.customer_id, r.id, v_monto, coalesce(q.moneda, 'MXN'), 'portal',
            'Registrada sola al marcar Ganada en la solicitud ' || coalesce(r.folio, ''))
    returning id into v_venta;
  else
    update public.ventas set monto = coalesce(monto, 0) + coalesce(v_monto, 0) where id = v_venta;
  end if;
  insert into public.venta_lineas (venta_id, articulo_id, descripcion, cantidad)
  values (v_venta, (select id from public.articulos where vendible and lower(nombre) = lower(i.producto) limit 1),
          left(coalesce(nullif(i.producto, ''), 'Partida ' || coalesce(i.folio, '')), 300), v_qty);
  return null;
end $$;
create trigger item_outcomes_ventas after insert or update on public.item_outcomes
  for each row execute function public.ventas_on_outcome();

revoke all on function public.ventas_before(), public.ventas_after(), public.ventas_on_outcome() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Demostracion: ventas diarias + prospeccion
-- ---------------------------------------------------------------------------
create or replace function public.demo_bitacora() returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seller uuid; n integer := 0; m integer := 0; d date := public.local_today(); b record; v_c uuid;
begin
  -- Ventas diarias a clientes
  for b in select * from (values
    (0, 'Manufacturas del Norte (Demo)', 0, 'OC 7781', 'A-1301', 48500, 'credito', 30, true, 0, 'guante de nitrilo', 40),
    (1, 'Autopartes Bravo (Demo)', 0, 'OC 45190', 'A-1302', 12800, 'contado', null, false, 100, 'bata', 30),
    (0, 'Hospital Santa Clara (Demo)', 1, null, 'A-1295', 9600, 'credito', 15, true, 50, 'cubrebocas', 20),
    (1, 'Alimentos La Sierra (Demo)', 3, 'OC 2210', 'A-1288', 15400, 'contado', null, true, 100, 'mandil', 25),
    (0, 'Autopartes Bravo (Demo)', 45, 'OC 44012', 'A-1201', 32000, 'credito', 30, true, 50, 'bata', 80),
    (1, 'Manufacturas del Norte (Demo)', 8, 'OC 7702', 'A-1260', 21300, 'credito', 30, true, 0, 'wipe', 15)
  ) as t(k, cliente, hace, pedido, factura, monto, pago, dias, entregado, cobrado, art, qty) loop
    v_seller := public.demo_seller(b.k);
    perform public.demo_as(v_seller);
    insert into public.ventas (customer_id, fecha, pedido, factura, monto, pago, dias_credito, entregado, porcentaje_cobrado, comentarios)
    values (public.demo_customer(b.cliente), d - b.hace, b.pedido, b.factura, b.monto, b.pago, b.dias, b.entregado, b.cobrado,
            case when b.hace = 45 then 'Cliente pide pagar el resto la otra semana' end)
    returning id into v_id;
    insert into public.venta_lineas (venta_id, articulo_id, descripcion, cantidad)
    select v_id, a.id, a.nombre, b.qty from public.articulos a where a.id = public.demo_articulo(b.art);
    m := m + 1;
  end loop;

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
    -- Ensambles ya compro: su primera venta lo vuelve cliente y cierra la prospeccion como ganada.
    if b.k = 4 then
      update public.bitacora set fecha_solicitud_compras = d - 10, fecha_cotizacion = d - 8 where id = v_id;
      insert into public.ventas (customer_id, fecha, pedido, monto, pago, dias_credito, comentarios)
      values (v_c, d - 2, 'OC 0091', 21800, 'credito', 30, 'Primera compra') returning id into v_id;
      insert into public.venta_lineas (venta_id, articulo_id, descripcion, cantidad)
      select v_id, a.id, a.nombre, 50 from public.articulos a where a.id = public.demo_articulo('wipe');
      m := m + 1;
    end if;
  end loop;

  -- Prospecto que llego del sitio web, sin vendedor.
  perform public.demo_as(null);
  insert into public.customers (nombre, tipo, giro, estado_geo, contacto_nombre, contacto_telefono, contacto_correo)
  select 'Clínica Dental Sonrisa (Demo)', 'prospecto', 'Salud', 'Chihuahua', 'Marcela Gil', '614 111 2233', 'contacto@sonrisa-demo.mx'
   where public.demo_customer('Clínica Dental Sonrisa (Demo)') is null;
  insert into public.bitacora (customer_id, necesidad, comentarios, origen)
  values (public.demo_customer('Clínica Dental Sonrisa (Demo)'), 'Cubrebocas y guantes de nitrilo para consultorio', 'Mensaje del formulario: Cotización mensual', 'sitio_web');
  return m || ' ventas diarias y ' || (n + 1) || ' prospectos';
end $$;
revoke all on function public.demo_bitacora() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guias: paqueterias que usa ESC
-- ---------------------------------------------------------------------------
alter table public.guias drop constraint if exists guias_paqueteria_check;
select set_config('esc.guia_rpc', '1', true);
update public.guias set paqueteria = 'Paquete Express' where paqueteria = 'Paquetexpress';
update public.guias set paqueteria_otra = paqueteria, paqueteria = 'Otra'
 where paqueteria not in ('Paquete Express', 'Estafeta', 'Tinypack', 'Porteo', 'DHL', 'Otra');
select set_config('esc.guia_rpc', '', true);
alter table public.guias add constraint guias_paqueteria_check
  check (paqueteria in ('Paquete Express', 'Estafeta', 'Tinypack', 'Porteo', 'DHL', 'Otra'));

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
  values ('B-88', 'Hospital Santa Clara (Demo)', 'Paquete Express', '614 300 4050', 'Calle Rosales 120', '31000', 'Chihuahua', 'Chihuahua', 3, 20, 'Batas desechables')
  returning id into g3;
  insert into public.guias (factura, destinatario, paqueteria, telefono, calle_numero, cp, ciudad, estado_geo, bultos, peso_kg)
  values ('B-91', 'Autopartes Bravo (Demo)', 'Tinypack', '614 200 3040', 'Blvd. Ortiz Mena 3300', '31200', 'Chihuahua', 'Chihuahua', 1, 4)
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
revoke all on function public.demo_guias() from public, anon, authenticated;

commit;

-- VERIFICACION:
--   select to_regclass('public.ventas') is not null and to_regclass('public.venta_lineas') is not null;   -- true
