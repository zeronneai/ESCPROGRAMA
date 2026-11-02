-- =============================================================================
-- 0026_evaluaciones.sql   (requiere 0025_rol_almacen.sql YA aplicado)
-- Que hace:
--   * PROVEEDORES con datos completos (razon social, RFC, contacto, telefono, correo, direccion, que surte,
--     condiciones). El comprador los da de alta como los vendedores dan de alta clientes. "Evaluar" marca
--     cuales entran a la evaluacion.
--   * EVALUACION DE PROVEEDORES (dos veces al año): el comprador la activa cuando quiera; se programa sola
--     la siguiente 6 meses despues y se activa en automatico (aviso en la campanita). El comprador califica
--     sus 5 puntos y Almacen los suyos (Almacen solo la ve cuando esta activa). Escala 1 a 5.
--   * EVALUACION DE CLIENTES (el cliente califica a ESC): por periodo, cada vendedor genera un link unico por
--     cliente, lo manda y se ve si ya se envio y si ya respondio. 5 preguntas: No satisfactorio,
--     Satisfactorio o Muy satisfactorio. Mismo esquema de dos veces al año.
--   * Las preguntas quedan en una tabla para poder ajustarlas despues.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

create or replace function public.is_almacen() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('almacen'); $$;
grant execute on function public.is_almacen() to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Proveedores con datos
-- ---------------------------------------------------------------------------
alter table public.suppliers
  add column razon_social text check (razon_social is null or length(razon_social) <= 200),
  add column rfc text check (rfc is null or length(rfc) <= 20),
  add column tipo text not null default 'nacional' check (tipo in ('nacional', 'extranjero')),
  add column pais text check (pais is null or length(pais) <= 60),
  add column giro text check (giro is null or length(giro) <= 200),
  add column contacto_nombre text check (contacto_nombre is null or length(contacto_nombre) <= 150),
  add column telefono text check (telefono is null or length(telefono) <= 40),
  add column correo text check (correo is null or length(correo) <= 150),
  add column direccion text check (direccion is null or length(direccion) <= 300),
  add column sitio_web text check (sitio_web is null or length(sitio_web) <= 200),
  add column condiciones_pago text check (condiciones_pago is null or length(condiciones_pago) <= 150),
  add column notas text check (notas is null or length(notas) <= 1000),
  add column evaluar boolean not null default false,
  add column created_by uuid references public.profiles (id);

revoke insert, update on public.suppliers from authenticated;
grant insert (nombre, razon_social, rfc, tipo, pais, giro, contacto_nombre, telefono, correo, direccion, sitio_web,
              condiciones_pago, notas, evaluar, created_by) on public.suppliers to authenticated;
grant update (nombre, activo, razon_social, rfc, tipo, pais, giro, contacto_nombre, telefono, correo, direccion, sitio_web,
              condiciones_pago, notas, evaluar) on public.suppliers to authenticated;
drop policy suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (public.is_buyer() or public.is_almacen() or public.is_gerente() or public.is_iso());

-- ---------------------------------------------------------------------------
-- 2) Periodos y preguntas
-- ---------------------------------------------------------------------------
create table public.eval_periodos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('proveedores', 'clientes')),
  nombre text not null,
  estado text not null check (estado in ('programado', 'activo', 'cerrado')),
  programado_para date,
  activado_at timestamptz,
  activado_por uuid references public.profiles (id),
  cerrado_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index eval_periodos_activo_idx on public.eval_periodos (tipo) where estado = 'activo';
create unique index eval_periodos_programado_idx on public.eval_periodos (tipo) where estado = 'programado';

create table public.eval_preguntas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('proveedor', 'cliente')),
  responsable text not null check (responsable in ('comprador', 'almacen', 'cliente')),
  orden integer not null,
  texto text not null check (length(texto) between 3 and 200),
  ayuda text check (ayuda is null or length(ayuda) <= 300),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.eval_preguntas (tipo, responsable, orden, texto, ayuda) values
  ('proveedor', 'comprador', 1, 'Comunicación y tiempo de respuesta', 'Contesta rápido, da seguimiento y avisa de cambios'),
  ('proveedor', 'comprador', 2, 'Entrega a tiempo', 'Cumple la fecha de entrega comprometida'),
  ('proveedor', 'comprador', 3, 'Precio y condiciones comerciales', 'Precio competitivo, crédito y condiciones de pago'),
  ('proveedor', 'comprador', 4, 'Documentación correcta', 'Factura, certificados y documentos de importación sin errores'),
  ('proveedor', 'comprador', 5, 'Atención a problemas o reclamos', 'Resuelve devoluciones, faltantes o garantías'),
  ('proveedor', 'almacen', 1, 'Producto en buen estado', 'Llega sin golpes, daños ni humedad'),
  ('proveedor', 'almacen', 2, 'Pedido completo', 'Cantidades y piezas correctas contra la orden de compra'),
  ('proveedor', 'almacen', 3, 'Empaque e identificación', 'Embalaje adecuado y producto etiquetado'),
  ('proveedor', 'almacen', 4, 'Producto conforme a lo solicitado', 'Modelo, talla y especificación correctos'),
  ('proveedor', 'almacen', 5, 'Documentos de entrega', 'Remisión o packing list correctos al recibir'),
  ('cliente', 'cliente', 1, 'Atención y trato de su vendedor', null),
  ('cliente', 'cliente', 2, 'Tiempo de respuesta a sus cotizaciones', null),
  ('cliente', 'cliente', 3, 'Calidad de los productos recibidos', null),
  ('cliente', 'cliente', 4, 'Cumplimiento en los tiempos de entrega', null),
  ('cliente', 'cliente', 5, 'Seguimiento y solución a dudas o problemas', null);

-- ---------------------------------------------------------------------------
-- 3) Evaluaciones
-- ---------------------------------------------------------------------------
create table public.eval_proveedor (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.eval_periodos (id),
  supplier_id uuid not null references public.suppliers (id),
  comprador_resp jsonb not null default '{}',
  comprador_comentario text check (comprador_comentario is null or length(comprador_comentario) <= 1000),
  comprador_por uuid references public.profiles (id),
  comprador_at timestamptz,
  almacen_resp jsonb not null default '{}',
  almacen_comentario text check (almacen_comentario is null or length(almacen_comentario) <= 1000),
  almacen_por uuid references public.profiles (id),
  almacen_at timestamptz,
  puntaje numeric(5, 1),
  created_at timestamptz not null default now(),
  unique (periodo_id, supplier_id)
);

create table public.encuestas_cliente (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.eval_periodos (id),
  customer_id uuid not null references public.customers (id),
  vendedor_id uuid not null references public.profiles (id),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  enviada_at timestamptz,
  medio text check (medio is null or medio in ('whatsapp', 'correo', 'otro')),
  respondida_at timestamptz,
  respuestas jsonb not null default '{}',
  comentario text check (comentario is null or length(comentario) <= 1000),
  contesto_nombre text check (contesto_nombre is null or length(contesto_nombre) <= 150),
  puntaje numeric(5, 1),
  created_at timestamptz not null default now(),
  unique (periodo_id, customer_id)
);
create index encuestas_vendedor_idx on public.encuestas_cliente (vendedor_id, periodo_id);

create trigger eval_proveedor_audit after insert or update on public.eval_proveedor for each row execute function public.audit_row();
create trigger encuestas_audit after insert or update on public.encuestas_cliente for each row execute function public.audit_row();
create trigger eval_periodos_audit after insert or update on public.eval_periodos for each row execute function public.audit_row();
create trigger eval_preguntas_audit after insert or update on public.eval_preguntas for each row execute function public.audit_row();
create trigger eval_proveedor_no_delete before delete on public.eval_proveedor for each row execute function public.forbid_mutation();
create trigger encuestas_no_delete before delete on public.encuestas_cliente for each row execute function public.forbid_mutation();
create trigger eval_periodos_no_delete before delete on public.eval_periodos for each row execute function public.forbid_mutation();

alter table public.eval_periodos enable row level security;
alter table public.eval_preguntas enable row level security;
alter table public.eval_proveedor enable row level security;
alter table public.encuestas_cliente enable row level security;
revoke all on public.eval_periodos, public.eval_preguntas, public.eval_proveedor, public.encuestas_cliente from anon, authenticated;
grant select on public.eval_periodos, public.eval_preguntas, public.eval_proveedor, public.encuestas_cliente to authenticated;
grant update (texto, ayuda, activo) on public.eval_preguntas to authenticated;
create policy eval_periodos_select on public.eval_periodos for select to authenticated using (public.is_active_user());
create policy eval_preguntas_select on public.eval_preguntas for select to authenticated using (public.is_active_user());
create policy eval_preguntas_update on public.eval_preguntas for update to authenticated
  using (public.is_buyer() and tipo = 'proveedor' or (public.is_buyer() or public.is_sales_manager()) and tipo = 'cliente')
  with check (public.is_buyer() or public.is_sales_manager());
create policy eval_proveedor_select on public.eval_proveedor for select to authenticated
  using (public.is_buyer() or public.is_gerente() or public.is_iso()
         or (public.is_almacen() and exists (select 1 from public.eval_periodos p where p.id = periodo_id and p.estado <> 'programado')));
create policy encuestas_select on public.encuestas_cliente for select to authenticated
  using (vendedor_id = auth.uid() or public.is_buyer() or public.is_sales_reader());

-- ---------------------------------------------------------------------------
-- 4) Activacion (manual o automatica a los 6 meses)
-- ---------------------------------------------------------------------------
create or replace function public.eval_nombre_periodo(p_fecha date) returns text
language sql immutable as $$
  select extract(year from p_fecha)::int || ' · ' || case when extract(month from p_fecha) <= 6 then '1er semestre' else '2do semestre' end;
$$;

-- Nucleo: cierra el activo, activa (el programado o uno nuevo), programa el siguiente y avisa.
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
    perform public.notify_role('comprador', 'evaluacion_activa', 'Evaluación de proveedores activa (' || v_nombre || ')',
      n || ' proveedor(es) por evaluar.', '/evaluaciones/proveedores', v_id);
  else
    perform public.notify_role('vendedor', 'evaluacion_activa', 'Evaluación de clientes activa (' || v_nombre || ')',
      'Genera el link de cada cliente y mándaselo para que califique a ESC.', '/evaluaciones/clientes', v_id);
    perform public.notify_role('jefe_ventas', 'evaluacion_activa', 'Evaluación de clientes activa (' || v_nombre || ')',
      'Los vendedores ya pueden mandar la encuesta a sus clientes.', '/evaluaciones/clientes', v_id);
  end if;
  return v_id;
end $$;
revoke all on function public.eval_activar_core(text, uuid) from public, anon, authenticated;

-- Manual: comprador (proveedores) o comprador / jefa de ventas (clientes).
create or replace function public.eval_activar(p_tipo text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if p_tipo not in ('proveedores', 'clientes') then raise exception 'Tipo invalido'; end if;
  if not (public.is_buyer() or (p_tipo = 'clientes' and public.is_sales_manager())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return public.eval_activar_core(p_tipo, auth.uid());
end $$;
grant execute on function public.eval_activar(text) to authenticated;

create or replace function public.eval_cerrar(p_tipo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_buyer() or (p_tipo = 'clientes' and public.is_sales_manager())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update public.eval_periodos set estado = 'cerrado', cerrado_at = now() where tipo = p_tipo and estado = 'activo';
end $$;
grant execute on function public.eval_cerrar(text) to authenticated;

-- Automatica (tarea diaria): activa los programados que ya llegaron a su fecha.
create or replace function public.eval_activar_programados() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select tipo from public.eval_periodos where estado = 'programado' and programado_para <= public.local_today() loop
    perform public.eval_activar_core(r.tipo, null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.eval_activar_programados() from public, anon, authenticated;
grant execute on function public.eval_activar_programados() to service_role;

-- Si el comprador marca "Evaluar" a un proveedor con la evaluacion activa, entra a la lista.
create or replace function public.suppliers_eval_add() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.evaluar and new.activo then
    insert into public.eval_proveedor (periodo_id, supplier_id)
    select id, new.id from public.eval_periodos where tipo = 'proveedores' and estado = 'activo'
    on conflict do nothing;
  end if;
  return null;
end $$;
create trigger suppliers_eval_add after insert or update of evaluar, activo on public.suppliers
  for each row execute function public.suppliers_eval_add();
revoke all on function public.suppliers_eval_add() from public, anon, authenticated;

-- Alta manual de proveedor: queda quien lo dio de alta y entra a la evaluacion.
create or replace function public.suppliers_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.nombre := trim(new.nombre);
  new.rfc := nullif(upper(regexp_replace(coalesce(new.rfc, ''), '[\s.-]', '', 'g')), '');
  new.correo := nullif(lower(trim(coalesce(new.correo, ''))), '');
  return new;
end $$;
create trigger suppliers_before before insert or update on public.suppliers
  for each row execute function public.suppliers_before();
revoke all on function public.suppliers_before() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Calificar proveedor (cada quien su parte; escala 1 a 5)
-- ---------------------------------------------------------------------------
create or replace function public.eval_proveedor_guardar(p_id uuid, p_resp jsonb, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.eval_proveedor; v_lado text; v_ids uuid[]; k text; v numeric; v_all numeric[];
begin
  v_lado := case when public.is_buyer() then 'comprador' when public.is_almacen() then 'almacen' end;
  if v_lado is null then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into e from public.eval_proveedor where id = p_id for update;
  if e.id is null then raise exception 'Evaluacion no encontrada'; end if;
  if not exists (select 1 from public.eval_periodos where id = e.periodo_id and estado = 'activo') then
    raise exception 'Este periodo de evaluacion ya esta cerrado';
  end if;
  select array_agg(id) into v_ids from public.eval_preguntas where tipo = 'proveedor' and responsable = v_lado and activo;
  if jsonb_typeof(p_resp) <> 'object' then raise exception 'Respuestas invalidas'; end if;
  foreach k in array array(select jsonb_object_keys(p_resp)) loop
    if not (k::uuid = any (v_ids)) then raise exception 'Pregunta invalida'; end if;
    v := (p_resp ->> k)::numeric;
    if v is null or v not in (1, 2, 3, 4, 5) then raise exception 'Cada punto se califica del 1 al 5'; end if;
  end loop;
  if (select count(*) from unnest(v_ids) x where p_resp ? x::text) < coalesce(array_length(v_ids, 1), 0) then
    raise exception 'Califica todos los puntos';
  end if;
  if v_lado = 'comprador' then
    update public.eval_proveedor set comprador_resp = p_resp, comprador_comentario = nullif(left(trim(coalesce(p_comentario, '')), 1000), ''),
           comprador_por = auth.uid(), comprador_at = now() where id = p_id returning * into e;
  else
    update public.eval_proveedor set almacen_resp = p_resp, almacen_comentario = nullif(left(trim(coalesce(p_comentario, '')), 1000), ''),
           almacen_por = auth.uid(), almacen_at = now() where id = p_id returning * into e;
  end if;
  select array_agg(value::numeric) into v_all
    from (select value from jsonb_each_text(e.comprador_resp) union all select value from jsonb_each_text(e.almacen_resp)) x;
  update public.eval_proveedor set puntaje = round((select avg(x) from unnest(v_all) x) * 20, 1) where id = p_id;
end $$;
grant execute on function public.eval_proveedor_guardar(uuid, jsonb, text) to authenticated;

-- Los clientes con ventas del vendedor tambien son "suyos" (para verlos y evaluarlos).
create or replace function public.can_see_customer(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or (public.is_seller() and exists (
    select 1 from public.customers c
     where c.id = p_id and (
       c.created_by = auth.uid()
       or exists (select 1 from public.quote_requests r where r.customer_id = c.id and r.vendedor_id = auth.uid())
       or exists (select 1 from public.bitacora b where b.customer_id = c.id and (b.vendedor_id = auth.uid() or b.vendedor_id is null))
       or exists (select 1 from public.ventas v where v.customer_id = c.id and v.vendedor_id = auth.uid())
       or exists (select 1 from public.leads l where l.customer_id = c.id and (l.vendedor_id = auth.uid() or l.vendedor_id is null))
     )
  ));
$$;

-- ---------------------------------------------------------------------------
-- 6) Encuesta del cliente (link unico por cliente y periodo)
-- ---------------------------------------------------------------------------
create or replace function public.encuesta_generar(p_customer uuid) returns public.encuestas_cliente
language plpgsql security definer set search_path = public as $$
declare v_p uuid; r public.encuestas_cliente;
begin
  if not public.is_seller() then raise exception 'Solo los vendedores generan el link' using errcode = '42501'; end if;
  if not public.can_see_customer(p_customer) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select id into v_p from public.eval_periodos where tipo = 'clientes' and estado = 'activo';
  if v_p is null then raise exception 'La evaluacion de clientes no esta activa'; end if;
  insert into public.encuestas_cliente (periodo_id, customer_id, vendedor_id) values (v_p, p_customer, auth.uid())
  on conflict (periodo_id, customer_id) do nothing;
  select * into r from public.encuestas_cliente where periodo_id = v_p and customer_id = p_customer;
  return r;
end $$;
grant execute on function public.encuesta_generar(uuid) to authenticated;

create or replace function public.encuesta_marcar_enviada(p_id uuid, p_medio text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_medio not in ('whatsapp', 'correo', 'otro') then raise exception 'Medio invalido'; end if;
  update public.encuestas_cliente set enviada_at = coalesce(enviada_at, now()), medio = p_medio
   where id = p_id and vendedor_id = auth.uid();
  if not found then raise exception 'No autorizado' using errcode = '42501'; end if;
end $$;
grant execute on function public.encuesta_marcar_enviada(uuid, text) to authenticated;

-- Publico (sin sesion): solo con el token.
create or replace function public.encuesta_publica(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cliente', c.nombre, 'vendedor', p.nombre, 'periodo', ep.nombre, 'respondida', e.respondida_at is not null,
    'preguntas', (select jsonb_agg(jsonb_build_object('id', q.id, 'texto', q.texto) order by q.orden)
                    from public.eval_preguntas q where q.tipo = 'cliente' and q.activo))
    from public.encuestas_cliente e
    join public.customers c on c.id = e.customer_id
    join public.profiles p on p.id = e.vendedor_id
    join public.eval_periodos ep on ep.id = e.periodo_id
   where e.token = p_token and length(p_token) >= 32;
$$;

create or replace function public.encuesta_responder(p_token text, p_resp jsonb, p_comentario text default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.encuestas_cliente; v_ids uuid[]; k text; v numeric; v_cliente text;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Link invalido'; end if;
  select * into e from public.encuestas_cliente where token = p_token for update;
  if e.id is null then raise exception 'Link invalido'; end if;
  if e.respondida_at is not null then raise exception 'Esta encuesta ya fue respondida. Gracias.'; end if;
  select array_agg(id) into v_ids from public.eval_preguntas where tipo = 'cliente' and activo;
  if jsonb_typeof(p_resp) <> 'object' then raise exception 'Respuestas invalidas'; end if;
  foreach k in array array(select jsonb_object_keys(p_resp)) loop
    if not (k::uuid = any (v_ids)) then raise exception 'Pregunta invalida'; end if;
    v := (p_resp ->> k)::numeric;
    if v is null or v not in (1, 2, 3) then raise exception 'Respuesta invalida'; end if;
  end loop;
  if (select count(*) from unnest(v_ids) x where p_resp ? x::text) < coalesce(array_length(v_ids, 1), 0) then
    raise exception 'Responde todas las preguntas';
  end if;
  update public.encuestas_cliente
     set respuestas = p_resp, respondida_at = now(), enviada_at = coalesce(enviada_at, now()),
         comentario = nullif(left(trim(coalesce(p_comentario, '')), 1000), ''),
         contesto_nombre = nullif(left(trim(coalesce(p_nombre, '')), 150), ''),
         puntaje = round(((select avg(value::numeric) from jsonb_each_text(p_resp)) - 1) / 2 * 100, 1)
   where id = e.id;
  select nombre into v_cliente from public.customers where id = e.customer_id;
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  values (e.vendedor_id, 'encuesta_respondida', v_cliente || ' respondió la evaluación', null, '/evaluaciones/clientes', e.id);
end $$;
revoke all on function public.encuesta_publica(text), public.encuesta_responder(text, jsonb, text, text) from public;
grant execute on function public.encuesta_publica(text), public.encuesta_responder(text, jsonb, text, text) to anon, authenticated;

commit;

-- VERIFICACION:
--   select tipo, responsable, count(*) from public.eval_preguntas group by 1, 2;   -- 5 comprador, 5 almacen, 5 cliente
