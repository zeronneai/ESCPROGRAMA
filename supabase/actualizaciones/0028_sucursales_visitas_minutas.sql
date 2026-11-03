-- =============================================================================
-- 0028_sucursales_visitas_minutas.sql   (requiere 0027_roles_supervisores.sql YA aplicado)
-- Que hace:
--   * SUCURSALES: un cliente puede tener otras direcciones con titulo (ej. "Sucursal Delicias"). Cada
--     sucursal es un cliente aparte (para ventas, bitacora y evaluacion) que hereda los datos de la matriz;
--     solo cambian direccion y contacto.
--   * VENTAS DIARIAS: se puede registrar una VISITA SIN VENTA (fue con el cliente y no compro) con el motivo.
--   * GUIAS: se elige si se manda en bultos o en tarima.
--   * ENCUESTA DE SATISFACCION DE CLIENTE (ESC-VEN-FR-002): 10 preguntas con Insatisfecho, Poco satisfecho,
--     Satisfecho y Muy satisfecho, recomendaciones, nombre y puesto de quien contesta. Queda activa ya y
--     abierta hasta el 1 de marzo de 2027. Los periodos pueden tener fecha de cierre.
--   * DEMOSTRACION: se puede quitar desde Configuracion (borra solo lo que creo la demostracion).
--   * MINUTAS: los jefes de departamento hacen minutas por pasos (agenda, desarrollo, compromisos con
--     responsable y fecha), eligen quien firma y a esas personas les llega aviso para revisarla y firmar.
--   * Supervisor de almacen tambien califica a los proveedores (como Almacen).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Sucursales
-- ---------------------------------------------------------------------------
alter table public.customers
  add column parent_id uuid references public.customers (id),
  add column sucursal text check (sucursal is null or length(trim(sucursal)) between 2 and 80);
alter table public.customers add constraint customers_sucursal_check2 check ((parent_id is null) = (sucursal is null));
create index customers_parent_idx on public.customers (parent_id) where parent_id is not null;
grant insert (parent_id, sucursal) on public.customers to authenticated;
grant update (sucursal) on public.customers to authenticated;

-- La sucursal toma de la matriz lo que no cambia (razon social, RFC, giro y estatus).
create or replace function public.customers_sucursal() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.customers;
begin
  if new.parent_id is null then return new; end if;
  select * into p from public.customers where id = new.parent_id;
  if p.id is null or p.parent_id is not null then raise exception 'La matriz no existe o ya es una sucursal'; end if;
  if coalesce(trim(new.sucursal), '') = '' then raise exception 'Escribe el nombre de la sucursal'; end if;
  new.sucursal := trim(new.sucursal);
  new.nombre := p.nombre || ' · ' || new.sucursal;
  new.estado_geo := coalesce(new.estado_geo, p.estado_geo);
  if TG_OP = 'INSERT' then
    new.tipo := p.tipo;
    new.giro := p.giro;
    new.razon_social := p.razon_social;
    new.rfc := p.rfc;
  end if;
  return new;
end $$;
create trigger customers_sucursal before insert or update on public.customers
  for each row execute function public.customers_sucursal();
revoke all on function public.customers_sucursal() from public, anon, authenticated;

-- Si la matriz pasa a cliente, sus sucursales tambien.
create or replace function public.customers_sucursal_tipo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is null and new.tipo is distinct from old.tipo then
    update public.customers set tipo = new.tipo where parent_id = new.id and tipo is distinct from new.tipo;
  end if;
  return null;
end $$;
create trigger customers_sucursal_tipo after update of tipo on public.customers
  for each row execute function public.customers_sucursal_tipo();
revoke all on function public.customers_sucursal_tipo() from public, anon, authenticated;

-- El vendedor ve las sucursales de los clientes que ve.
create or replace function public.can_see_customer(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or (public.is_seller() and exists (
    select 1 from public.customers c
     where c.id = p_id and exists (
       select 1 from public.customers x
        where x.id in (c.id, c.parent_id) and (
          x.created_by = auth.uid()
          or exists (select 1 from public.quote_requests r where r.customer_id = x.id and r.vendedor_id = auth.uid())
          or exists (select 1 from public.bitacora b where b.customer_id = x.id and (b.vendedor_id = auth.uid() or b.vendedor_id is null))
          or exists (select 1 from public.ventas v where v.customer_id = x.id and v.vendedor_id = auth.uid())
          or exists (select 1 from public.leads l where l.customer_id = x.id and (l.vendedor_id = auth.uid() or l.vendedor_id is null))))
  ));
$$;

-- ---------------------------------------------------------------------------
-- 2) Visita sin venta
-- ---------------------------------------------------------------------------
alter table public.ventas
  add column tipo text not null default 'venta' check (tipo in ('venta', 'visita')),
  add column motivo_no_venta text check (motivo_no_venta is null or length(motivo_no_venta) <= 300);
alter table public.ventas add constraint ventas_visita_motivo check (tipo <> 'visita' or motivo_no_venta is not null);
grant insert (tipo, motivo_no_venta) on public.ventas to authenticated;
grant update (motivo_no_venta) on public.ventas to authenticated;

create or replace function public.ventas_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' and new.tipo = 'venta' then
    update public.customers set tipo = 'cliente' where id = new.customer_id and tipo = 'prospecto';
    update public.bitacora
       set resultado = 'ganada', fecha_pedido = coalesce(fecha_pedido, new.fecha),
           monto_venta = coalesce(monto_venta, new.monto)
     where customer_id = new.customer_id and vendedor_id = new.vendedor_id and resultado = 'abierta' and archived_at is null;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Guias: bultos o tarima
-- ---------------------------------------------------------------------------
alter table public.guias add column empaque text not null default 'bulto' check (empaque in ('bulto', 'tarima'));
grant insert (empaque) on public.guias to authenticated;
grant update (empaque) on public.guias to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Encuesta de satisfaccion de cliente (ESC-VEN-FR-002)
-- ---------------------------------------------------------------------------
alter table public.eval_periodos add column cierra_el date;
alter table public.encuestas_cliente
  add column escala smallint not null default 4 check (escala in (3, 4)),
  add column contesto_puesto text check (contesto_puesto is null or length(contesto_puesto) <= 120);
update public.encuestas_cliente set escala = 3;
alter table public.encuestas_cliente alter column escala set default 4;

update public.eval_preguntas set activo = false where tipo = 'cliente';
insert into public.eval_preguntas (tipo, responsable, orden, texto) values
  ('cliente', 'cliente', 1, '¿Qué tan efectiva y rápida es la solución a sus dudas, cotizaciones y pedidos?'),
  ('cliente', 'cliente', 2, '¿Qué tan fácil y rápido es recibir sus facturas o solicitar corrección de facturas?'),
  ('cliente', 'cliente', 3, '¿Qué tan satisfecho está con el producto recibido?'),
  ('cliente', 'cliente', 4, '¿Cómo calificaría la atención de nuestros asesores de venta (amabilidad y disponibilidad)?'),
  ('cliente', 'cliente', 5, '¿El personal de reparto o la línea de transporte cumple con el horario o ventana de entrega programada?'),
  ('cliente', 'cliente', 6, 'Calidad del producto recibido: ¿cumplió con especificaciones, sin daños y completo?'),
  ('cliente', 'cliente', 7, 'En caso de un error, retraso o producto dañado, ¿cómo califica la velocidad y respuesta en la gestión del problema?'),
  ('cliente', 'cliente', 8, '¿Qué tan satisfecho está con la disponibilidad de inventario y variedad de productos?'),
  ('cliente', 'cliente', 9, '¿El personal de ventas demuestra conocimiento de los productos para recomendarle las mejores opciones según sus necesidades?'),
  ('cliente', 'cliente', 10, '¿Qué tan satisfecho está con el seguimiento que se le da como cliente de ESC Representaciones?');

-- Activar con fecha de cierre opcional.
create or replace function public.eval_activar(p_tipo text, p_hasta date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_tipo not in ('proveedores', 'clientes') then raise exception 'Tipo invalido'; end if;
  if not (public.is_buyer() or (p_tipo = 'clientes' and public.is_sales_manager())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_hasta is not null and p_hasta <= public.local_today() then raise exception 'La fecha de cierre debe ser futura'; end if;
  v_id := public.eval_activar_core(p_tipo, auth.uid());
  update public.eval_periodos set cierra_el = p_hasta where id = v_id;
  return v_id;
end $$;
drop function if exists public.eval_activar(text);
grant execute on function public.eval_activar(text, date) to authenticated;

-- Cambiar la fecha de cierre del periodo activo.
create or replace function public.eval_fecha_cierre(p_tipo text, p_hasta date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_buyer() or (p_tipo = 'clientes' and public.is_sales_manager())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_hasta is not null and p_hasta <= public.local_today() then raise exception 'La fecha de cierre debe ser futura'; end if;
  update public.eval_periodos set cierra_el = p_hasta where tipo = p_tipo and estado = 'activo';
end $$;
grant execute on function public.eval_fecha_cierre(text, date) to authenticated;

-- Tarea diaria: cierra los que llegaron a su fecha de cierre y activa los programados.
create or replace function public.eval_activar_programados() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  update public.eval_periodos set estado = 'cerrado', cerrado_at = now()
   where estado = 'activo' and cierra_el is not null and cierra_el < public.local_today();
  for r in select tipo from public.eval_periodos where estado = 'programado' and programado_para <= public.local_today() loop
    perform public.eval_activar_core(r.tipo, null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Encuesta publica: datos del cliente ya llenos.
create or replace function public.encuesta_publica(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cliente', c.nombre, 'razon_social', c.razon_social, 'direccion', c.direccion, 'contacto', c.contacto_nombre,
    'vendedor', p.nombre, 'periodo', ep.nombre, 'escala', e.escala,
    'respondida', e.respondida_at is not null,
    'cerrada', ep.estado = 'cerrado' or (ep.cierra_el is not null and ep.cierra_el < public.local_today()),
    'cierra_el', ep.cierra_el,
    'preguntas', (select jsonb_agg(jsonb_build_object('id', q.id, 'texto', q.texto) order by q.orden)
                    from public.eval_preguntas q where q.tipo = 'cliente' and q.activo))
    from public.encuestas_cliente e
    join public.customers c on c.id = e.customer_id
    join public.profiles p on p.id = e.vendedor_id
    join public.eval_periodos ep on ep.id = e.periodo_id
   where e.token = p_token and length(p_token) >= 32;
$$;

drop function if exists public.encuesta_responder(text, jsonb, text, text);
create or replace function public.encuesta_responder(p_token text, p_resp jsonb, p_comentario text default null,
                                                     p_nombre text default null, p_puesto text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.encuestas_cliente; ep public.eval_periodos; v_ids uuid[]; k text; v numeric; v_cliente text;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Link invalido'; end if;
  select * into e from public.encuestas_cliente where token = p_token for update;
  if e.id is null then raise exception 'Link invalido'; end if;
  if e.respondida_at is not null then raise exception 'Esta encuesta ya fue respondida. Gracias.'; end if;
  select * into ep from public.eval_periodos where id = e.periodo_id;
  if ep.estado = 'cerrado' or (ep.cierra_el is not null and ep.cierra_el < public.local_today()) then
    raise exception 'Esta encuesta ya cerró. Gracias.';
  end if;
  if coalesce(trim(p_puesto), '') = '' then raise exception 'Escriba su puesto'; end if;
  select array_agg(id) into v_ids from public.eval_preguntas where tipo = 'cliente' and activo;
  if jsonb_typeof(p_resp) <> 'object' then raise exception 'Respuestas invalidas'; end if;
  foreach k in array array(select jsonb_object_keys(p_resp)) loop
    if not (k::uuid = any (v_ids)) then raise exception 'Pregunta invalida'; end if;
    v := (p_resp ->> k)::numeric;
    if v is null or v < 1 or v > e.escala or v <> trunc(v) then raise exception 'Respuesta invalida'; end if;
  end loop;
  if (select count(*) from unnest(v_ids) x where p_resp ? x::text) < coalesce(array_length(v_ids, 1), 0) then
    raise exception 'Responda todas las preguntas';
  end if;
  update public.encuestas_cliente
     set respuestas = p_resp, respondida_at = now(), enviada_at = coalesce(enviada_at, now()),
         comentario = nullif(left(trim(coalesce(p_comentario, '')), 1000), ''),
         contesto_nombre = nullif(left(trim(coalesce(p_nombre, '')), 150), ''),
         contesto_puesto = left(trim(p_puesto), 120),
         puntaje = round(((select avg(value::numeric) from jsonb_each_text(p_resp)) - 1) / (e.escala - 1) * 100, 1)
   where id = e.id;
  select nombre into v_cliente from public.customers where id = e.customer_id;
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  values (e.vendedor_id, 'encuesta_respondida', v_cliente || ' respondió la encuesta de satisfacción', null, '/evaluaciones/clientes', e.id);
end $$;
revoke all on function public.encuesta_publica(text), public.encuesta_responder(text, jsonb, text, text, text) from public;
grant execute on function public.encuesta_publica(text), public.encuesta_responder(text, jsonb, text, text, text) to anon, authenticated;

-- No se genera link si el periodo ya cerro.
create or replace function public.encuesta_generar(p_customer uuid) returns public.encuestas_cliente
language plpgsql security definer set search_path = public as $$
declare v_p uuid; r public.encuestas_cliente;
begin
  if not public.is_seller() then raise exception 'Solo los vendedores generan el link' using errcode = '42501'; end if;
  if not public.can_see_customer(p_customer) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select id into v_p from public.eval_periodos
   where tipo = 'clientes' and estado = 'activo' and (cierra_el is null or cierra_el >= public.local_today());
  if v_p is null then raise exception 'La encuesta de clientes no esta activa'; end if;
  insert into public.encuestas_cliente (periodo_id, customer_id, vendedor_id) values (v_p, p_customer, auth.uid())
  on conflict (periodo_id, customer_id) do nothing;
  select * into r from public.encuestas_cliente where periodo_id = v_p and customer_id = p_customer;
  return r;
end $$;

-- Disponible desde ya y hasta el 1 de marzo de 2027.
do $$
declare v uuid;
begin
  select id into v from public.eval_periodos where tipo = 'clientes' and estado = 'activo';
  if v is null then
    v := public.eval_activar_core('clientes', null);
  end if;
  update public.eval_periodos set cierra_el = date '2027-03-01' where id = v;
end $$;

-- Supervisor de almacen califica como Almacen.
create or replace function public.is_almacen() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('almacen') or public.has_role('supervisor_almacen'); $$;
create or replace function public.eval_activar_core(p_tipo text, p_by uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hoy date := public.local_today(); v_nombre text; n integer;
begin
  update public.eval_periodos set estado = 'cerrado', cerrado_at = now() where tipo = p_tipo and estado = 'activo';
  select id into v_id from public.eval_periodos where tipo = p_tipo and estado = 'programado';
  v_nombre := public.eval_nombre_periodo(v_hoy);
  if v_id is not null then
    update public.eval_periodos set estado = 'activo', nombre = v_nombre, activado_at = now(), activado_por = p_by where id = v_id;
  else
    insert into public.eval_periodos (tipo, nombre, estado, activado_at, activado_por) values (p_tipo, v_nombre, 'activo', now(), p_by)
    returning id into v_id;
  end if;
  insert into public.eval_periodos (tipo, nombre, estado, programado_para)
  values (p_tipo, public.eval_nombre_periodo((v_hoy + interval '6 months')::date), 'programado', (v_hoy + interval '6 months')::date);
  if p_tipo = 'proveedores' then
    insert into public.eval_proveedor (periodo_id, supplier_id)
    select v_id, s.id from public.suppliers s where s.activo and s.evaluar on conflict do nothing;
    get diagnostics n = row_count;
    perform public.notify_role('almacen', 'evaluacion_activa', 'Evaluación de proveedores activa (' || v_nombre || ')',
      n || ' proveedor(es) por evaluar: estado, cantidades y empaque de lo que recibes.', '/evaluaciones/proveedores', v_id);
    perform public.notify_role('supervisor_almacen', 'evaluacion_activa', 'Evaluación de proveedores activa (' || v_nombre || ')',
      n || ' proveedor(es) por evaluar: estado, cantidades y empaque de lo que recibes.', '/evaluaciones/proveedores', v_id);
    perform public.notify_role('comprador', 'evaluacion_activa', 'Evaluación de proveedores activa (' || v_nombre || ')',
      n || ' proveedor(es) por evaluar.', '/evaluaciones/proveedores', v_id);
  else
    perform public.notify_role('vendedor', 'evaluacion_activa', 'Encuesta de satisfacción de clientes activa (' || v_nombre || ')',
      'Copia el link de cada cliente y mándaselo.', '/evaluaciones/clientes', v_id);
    perform public.notify_role('jefe_ventas', 'evaluacion_activa', 'Encuesta de satisfacción de clientes activa (' || v_nombre || ')',
      'Los vendedores ya pueden mandar la encuesta a sus clientes.', '/evaluaciones/clientes', v_id);
  end if;
  return v_id;
end $$;
drop policy suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (public.is_buyer() or public.is_almacen() or public.is_gerente() or public.is_iso());

-- ---------------------------------------------------------------------------
-- 5) Quitar la demostracion (solo lo que creo la demostracion)
-- ---------------------------------------------------------------------------
create or replace function public.demo_quitar() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_c uuid[]; v_r uuid[]; v_i uuid[]; v_is uuid[]; v_q uuid[]; v_s uuid[]; v_b uuid[]; v_v uuid[]; v_g uuid[]; v_k uuid[];
  t text; n integer;
  tablas text[] := array['quote_issue_sends', 'quote_issue_lines', 'quote_issues', 'quote_renegotiations', 'item_outcomes', 'item_purchases',
    'item_pdf_names', 'item_price_choice', 'item_update_requests', 'item_dispatch', 'item_sourcing', 'item_clarification_pauses',
    'item_messages', 'item_quotes', 'item_costs', 'item_references', 'quote_pdf_shipping_items', 'quote_pdf_min_choices', 'quote_pdf_data',
    'quote_items', 'quote_requests', 'venta_lineas', 'ventas', 'bitacora_articulos', 'bitacora_eventos', 'bitacora', 'calidad_archivos',
    'calidad_eventos', 'acciones_correctivas', 'quejas', 'consumo_eventos', 'consumo_solicitudes', 'guia_eventos', 'guias',
    'encuestas_cliente', 'customers', 'notifications', 'demo_cargas'];
begin
  if not public.is_buyer() then raise exception 'Solo el comprador quita la demostracion' using errcode = '42501'; end if;
  select array_agg(id) into v_c from public.customers where nombre like '%(Demo)%';
  v_c := coalesce(v_c, '{}');
  select coalesce(array_agg(id), '{}') into v_r from public.quote_requests where customer_id = any (v_c);
  select coalesce(array_agg(id), '{}') into v_i from public.quote_items where request_id = any (v_r);
  select coalesce(array_agg(id), '{}') into v_is from public.quote_issues where request_id = any (v_r);
  select coalesce(array_agg(id), '{}') into v_q from public.quejas where customer_id = any (v_c) or cliente_nombre like '%(Demo)%';
  select coalesce(array_agg(id), '{}') into v_s from public.acciones_correctivas where queja_id = any (v_q);
  select coalesce(array_agg(id), '{}') into v_b from public.bitacora where customer_id = any (v_c);
  select coalesce(array_agg(id), '{}') into v_v from public.ventas where customer_id = any (v_c);
  select coalesce(array_agg(id), '{}') into v_g from public.guias where customer_id = any (v_c) or destinatario like '%(Demo)%';
  select coalesce(array_agg(id), '{}') into v_k from public.consumo_solicitudes
   where (descripcion, motivo) in (('Hojas tamaño carta', 'Se acabaron, se usan para imprimir cotizaciones'),
                                   ('Afinación y cambio de aceite camioneta de reparto', 'Ya le toca por kilometraje'),
                                   ('Cloro y jabón para trastes', 'Limpieza de la oficina'),
                                   ('Café molido', 'Para clientes que visitan la oficina'),
                                   ('Hojas tamano carta', 'Se acabaron, se usan para imprimir cotizaciones'),
                                   ('Afinacion y cambio de aceite camioneta de reparto', 'Ya le toca por kilometraje'),
                                   ('Cloro y jabon para trastes', 'Limpieza de la oficina'),
                                   ('Cafe molido', 'Para clientes que visitan la oficina'));

  foreach t in array tablas loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  update public.quote_issues set renegociacion_id = null where id = any (v_is);
  delete from public.quote_issue_sends where issue_id = any (v_is);
  delete from public.quote_issue_lines where issue_id = any (v_is) or item_id = any (v_i);
  delete from public.quote_renegotiations where request_id = any (v_r);
  delete from public.quote_issues where id = any (v_is);
  foreach t in array array['item_outcomes', 'item_purchases', 'item_pdf_names', 'item_price_choice', 'item_update_requests', 'item_dispatch',
                           'item_sourcing', 'item_clarification_pauses', 'item_messages', 'item_quotes', 'item_costs', 'item_references',
                           'quote_pdf_shipping_items'] loop
    execute format('delete from public.%I where item_id = any ($1)', t) using v_i;
  end loop;
  delete from public.quote_pdf_min_choices where request_id = any (v_r) or item_id = any (v_i);
  delete from public.quote_pdf_data where request_id = any (v_r);
  delete from public.venta_lineas where venta_id = any (v_v);
  delete from public.ventas where id = any (v_v) or request_id = any (v_r);
  delete from public.bitacora_articulos where bitacora_id = any (v_b);
  delete from public.bitacora_eventos where bitacora_id = any (v_b);
  delete from public.bitacora where id = any (v_b) or request_id = any (v_r);
  delete from public.quote_items where id = any (v_i);
  delete from public.quote_requests where id = any (v_r);
  delete from public.calidad_archivos where queja_id = any (v_q) or sac_id = any (v_s);
  delete from public.calidad_eventos where queja_id = any (v_q) or sac_id = any (v_s);
  delete from public.acciones_correctivas where id = any (v_s);
  delete from public.quejas where id = any (v_q);
  delete from public.consumo_eventos where solicitud_id = any (v_k);
  delete from public.consumo_solicitudes where id = any (v_k);
  delete from public.guia_eventos where guia_id = any (v_g);
  delete from public.guias where id = any (v_g);
  delete from public.encuestas_cliente where customer_id = any (v_c);
  delete from public.notifications
   where ref_id = any (v_r || v_i || v_q || v_s || v_b || v_v || v_g || v_k || v_is);
  update public.customers set parent_id = null, sucursal = null where parent_id = any (v_c) and not (id = any (v_c));
  delete from public.customers where id = any (v_c);
  get diagnostics n = row_count;
  delete from public.demo_cargas;
  foreach t in array tablas loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  perform public.write_audit('demo_quitada', 'demo_cargas', null, null, null,
    jsonb_build_object('clientes', n, 'solicitudes', cardinality(v_r), 'ventas', cardinality(v_v), 'quejas', cardinality(v_q), 'guias', cardinality(v_g)));
  return n || ' clientes de demostración y todo lo ligado a ellos';
end $$;
revoke all on function public.demo_quitar() from public, anon;
grant execute on function public.demo_quitar() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Minutas
-- ---------------------------------------------------------------------------
create or replace function public.is_jefe_depto() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and not must_change_password
                  and rol in ('jefe_ventas', 'gerente', 'comprador', 'supervisor_almacen', 'supervisor_finanzas'));
$$;
grant execute on function public.is_jefe_depto() to authenticated;

create sequence public.minutas_seq;
create table public.minutas (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique default ('MIN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.minutas_seq')::text, 3, '0')),
  tema text not null check (length(trim(tema)) between 3 and 200),
  responsable text check (responsable is null or length(responsable) <= 150),
  lugar text check (lugar is null or length(lugar) <= 200),
  fecha date not null default public.local_today(),
  hora_inicio time,
  hora_fin time,
  agenda jsonb not null default '[]' check (jsonb_typeof(agenda) = 'array'),
  desarrollo jsonb not null default '[]' check (jsonb_typeof(desarrollo) = 'array'),
  compromisos jsonb not null default '[]' check (jsonb_typeof(compromisos) = 'array'),
  externos jsonb not null default '[]' check (jsonb_typeof(externos) = 'array'),
  proxima_tema text check (proxima_tema is null or length(proxima_tema) <= 200),
  proxima_fecha date,
  proxima_hora time,
  proxima_lugar text check (proxima_lugar is null or length(proxima_lugar) <= 200),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada')),
  enviada_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_by_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.minuta_firmas (
  minuta_id uuid not null references public.minutas (id),
  user_id uuid not null references public.profiles (id),
  nombre text,
  puesto text,
  correo text,
  firmada_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (minuta_id, user_id)
);

create or replace function public.can_read_minuta(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.minutas m where m.id = p_id and (m.created_by = auth.uid() or public.is_gerente()))
      or exists (select 1 from public.minuta_firmas f join public.minutas m on m.id = f.minuta_id
                  where f.minuta_id = p_id and f.user_id = auth.uid() and m.estado = 'enviada');
$$;
grant execute on function public.can_read_minuta(uuid) to authenticated;

create or replace function public.minutas_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_nombre := public.my_name();
    new.estado := 'borrador';
  elsif old.estado = 'enviada' and current_setting('esc.minuta_rpc', true) is distinct from '1' then
    raise exception 'La minuta ya se envio a firmas y no se puede editar';
  end if;
  return new;
end $$;
create trigger minutas_before before insert or update on public.minutas for each row execute function public.minutas_before();
create trigger minutas_updated before update on public.minutas for each row execute function public.set_updated_at();
create trigger minutas_audit after insert or update on public.minutas for each row execute function public.audit_row();
create trigger minutas_no_delete before delete on public.minutas for each row execute function public.forbid_mutation();
create trigger minuta_firmas_audit after insert or update or delete on public.minuta_firmas for each row execute function public.audit_row();
revoke all on function public.minutas_before() from public, anon, authenticated;

-- Firmantes: se eligen en borrador (datos copiados del usuario).
create or replace function public.minuta_firmantes(p_id uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare m public.minutas;
begin
  select * into m from public.minutas where id = p_id;
  if m.id is null or m.created_by <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if m.estado <> 'borrador' then raise exception 'La minuta ya se envio a firmas'; end if;
  delete from public.minuta_firmas where minuta_id = p_id and not (user_id = any (coalesce(p_users, '{}')));
  insert into public.minuta_firmas (minuta_id, user_id, nombre, puesto, correo)
  select p_id, p.id, p.nombre, p.rol::text, p.correo from public.profiles p where p.id = any (coalesce(p_users, '{}')) and p.activo
  on conflict (minuta_id, user_id) do nothing;
end $$;
grant execute on function public.minuta_firmantes(uuid, uuid[]) to authenticated;

create or replace function public.minuta_enviar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.minutas;
begin
  select * into m from public.minutas where id = p_id for update;
  if m.id is null or m.created_by <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if m.estado <> 'borrador' then raise exception 'Ya se envio'; end if;
  if not exists (select 1 from public.minuta_firmas where minuta_id = p_id) then raise exception 'Elige quien debe firmar'; end if;
  perform set_config('esc.minuta_rpc', '1', true);
  update public.minutas set estado = 'enviada', enviada_at = now() where id = p_id;
  perform set_config('esc.minuta_rpc', '', true);
  -- Quien la hizo firma al enviarla (si esta en la lista).
  update public.minuta_firmas set firmada_at = now() where minuta_id = p_id and user_id = auth.uid();
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  select f.user_id, 'minuta_firma', 'Minuta por firmar: ' || m.tema, m.numero || ' · ' || coalesce(m.created_by_nombre, ''),
         '/minutas/' || p_id, p_id
    from public.minuta_firmas f where f.minuta_id = p_id and f.user_id <> auth.uid();
end $$;
grant execute on function public.minuta_enviar(uuid) to authenticated;

create or replace function public.minuta_firmar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.minutas;
begin
  select * into m from public.minutas where id = p_id;
  if m.id is null or m.estado <> 'enviada' then raise exception 'La minuta no esta lista para firmar'; end if;
  update public.minuta_firmas set firmada_at = now() where minuta_id = p_id and user_id = auth.uid() and firmada_at is null;
  if not found then raise exception 'No te toca firmar esta minuta o ya la firmaste'; end if;
  if not exists (select 1 from public.minuta_firmas where minuta_id = p_id and firmada_at is null) then
    perform public.notify_user(m.created_by, 'minuta_firmada', 'Minuta firmada por todos: ' || m.tema, m.numero, '/minutas/' || p_id, p_id);
  end if;
end $$;
grant execute on function public.minuta_firmar(uuid) to authenticated;
revoke all on function public.minuta_firmantes(uuid, uuid[]), public.minuta_enviar(uuid), public.minuta_firmar(uuid) from anon;

alter table public.minutas enable row level security;
alter table public.minuta_firmas enable row level security;
revoke all on public.minutas, public.minuta_firmas from anon, authenticated;
grant usage on sequence public.minutas_seq to authenticated;
grant select on public.minutas, public.minuta_firmas to authenticated;
grant insert (id, tema, responsable, lugar, fecha, hora_inicio, hora_fin, agenda, desarrollo, compromisos, externos, proxima_tema,
              proxima_fecha, proxima_hora, proxima_lugar) on public.minutas to authenticated;
grant update (tema, responsable, lugar, fecha, hora_inicio, hora_fin, agenda, desarrollo, compromisos, externos, proxima_tema,
              proxima_fecha, proxima_hora, proxima_lugar) on public.minutas to authenticated;
create policy minutas_select on public.minutas for select to authenticated
  using (created_by = auth.uid() or public.can_read_minuta(id));
create policy minutas_insert on public.minutas for insert to authenticated with check (public.is_jefe_depto());
create policy minutas_update on public.minutas for update to authenticated
  using (created_by = auth.uid() and estado = 'borrador') with check (created_by = auth.uid());
create policy minuta_firmas_select on public.minuta_firmas for select to authenticated
  using (public.can_read_minuta(minuta_id) or exists (select 1 from public.minutas m where m.id = minuta_id and m.created_by = auth.uid()));

-- Usuarios a elegir como firmantes (solo nombre y puesto).
create or replace function public.minuta_usuarios() returns table (id uuid, nombre text, rol text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.rol::text from public.profiles p where p.activo and public.is_jefe_depto() order by p.nombre;
$$;
grant execute on function public.minuta_usuarios() to authenticated;

commit;

-- VERIFICACION:
--   select count(*) from public.eval_preguntas where tipo = 'cliente' and activo;              -- 10
--   select estado, cierra_el from public.eval_periodos where tipo = 'clientes' and estado = 'activo';  -- activo, 2027-03-01
