-- =============================================================================
-- 0021_calidad_consumo_guias.sql   (requiere 0020_roles_calidad.sql YA aplicado)
-- Que hace (todo con bitacora de auditoria; nada se borra):
--   * PUESTOS: Gerente (ve ventas, clientes, calidad, consumo y guias; no edita), Coordinador ISO (ve lo
--     mismo y es quien maneja quejas y acciones correctivas) y Marketplaces (atiende las guias).
--   * QUEJAS DE CLIENTE (ESC-SGC-FR-002): las capturan los vendedores o el coordinador ISO. El coordinador
--     cambia el estatus y las cierra. Cada cambio y comentario queda como evento.
--   * SOLICITUD DE ACCION CORRECTIVA (ESC-SGC-FR-001): solo el coordinador ISO la crea y edita
--     (reaccion, 6M, causa raiz, plan de accion, verificacion y cierre). Los vendedores la ven si viene de
--     una queja suya.
--   * CONSUMO INTERNO: papeleria, limpieza, servicios de vehiculos, etc. La jefa de ventas aprueba; solo
--     entonces el comprador la ve y marca su avance (pedido/agendado y recibido/realizado).
--   * GUIAS DE PAQUETERIA: el vendedor la pide con los datos del envio; Marketplaces la toma, pide datos si
--     faltan y sube la guia (PDF o imagen) para que el vendedor la descargue. Recordatorio a las 4 horas.
--   * Avisos en la campanita para cada paso.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Puestos
-- ---------------------------------------------------------------------------
create or replace function public.has_role(p_rol public.user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and not must_change_password and rol = p_rol);
$$;
create or replace function public.is_gerente() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('gerente'); $$;
create or replace function public.is_iso() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('coordinador_iso'); $$;
create or replace function public.is_marketplaces() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('marketplaces'); $$;
-- Lectura de ventas, clientes y bitacora de todos: jefa de ventas, gerente y coordinador ISO.
create or replace function public.is_sales_reader() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_sales_manager() or public.is_gerente() or public.is_iso();
$$;
create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$ select nombre from public.profiles where id = auth.uid(); $$;
grant execute on function public.has_role(public.user_role), public.is_gerente(), public.is_iso(), public.is_marketplaces(),
  public.is_sales_reader(), public.my_name() to authenticated;

-- La gerente y el coordinador ISO leen lo mismo que la jefa de ventas (sin costos ni proveedores).
create or replace function public.can_read_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.quote_requests r
     where r.id = p_request
       and ((r.vendedor_id = auth.uid())
            or ((public.is_buyer() or public.is_sales_reader()) and r.estado = 'enviada'))
  );
$$;
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_buyer() or public.is_sales_reader());
drop policy requests_select on public.quote_requests;
create policy requests_select on public.quote_requests for select to authenticated
  using (public.is_active_user() and
         (vendedor_id = auth.uid() or ((public.is_buyer() or public.is_sales_reader()) and estado = 'enviada')));
create or replace function public.can_read_bitacora(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or (public.is_seller() and exists (
    select 1 from public.bitacora b where b.id = p_id and (b.vendedor_id = auth.uid() or b.vendedor_id is null)
  ));
$$;
drop policy bitacora_select on public.bitacora;
create policy bitacora_select on public.bitacora for select to authenticated
  using (public.is_buyer() or public.is_sales_reader()
         or (public.is_seller() and (vendedor_id = auth.uid() or vendedor_id is null)));
create or replace function public.can_see_customer(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or (public.is_seller() and exists (
    select 1 from public.customers c
     where c.id = p_id and (
       c.created_by = auth.uid()
       or exists (select 1 from public.quote_requests r where r.customer_id = c.id and r.vendedor_id = auth.uid())
       or exists (select 1 from public.bitacora b where b.customer_id = c.id and (b.vendedor_id = auth.uid() or b.vendedor_id is null))
       or exists (select 1 from public.leads l where l.customer_id = c.id and (l.vendedor_id = auth.uid() or l.vendedor_id is null))
     )
  ));
$$;
-- Las imagenes del chat solo las suben comprador o vendedor (los demas puestos solo leen).
drop policy aclaraciones_insert on storage.objects;
create policy aclaraciones_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'aclaraciones' and (public.is_buyer() or public.is_seller())
              and public.can_read_request(public.storage_request_id(name)));

-- Avisos
create or replace function public.notify_role(p_rol public.user_role, p_tipo text, p_titulo text, p_cuerpo text,
                                              p_link text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  select id, p_tipo, left(p_titulo, 200), left(p_cuerpo, 300), p_link, p_ref
    from public.profiles where rol = p_rol and activo and id is distinct from auth.uid();
$$;
create or replace function public.notify_user(p_user uuid, p_tipo text, p_titulo text, p_cuerpo text,
                                              p_link text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  select p_user, p_tipo, left(p_titulo, 200), left(p_cuerpo, 300), p_link, p_ref
   where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public.notify_role(public.user_role, text, text, text, text, uuid),
  public.notify_user(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Nombre del autor en cada evento (los vendedores no leen la tabla de usuarios).
create or replace function public.set_autor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.autor_nombre := coalesce(new.autor_nombre, (select nombre from public.profiles where id = new.created_by));
  return new;
end $$;

-- Archivos (evidencias de calidad y guias). La ruta empieza con el id del registro.
create or replace function public.storage_first_uuid(p_name text) returns uuid
language sql immutable as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(p_name))[1])::uuid end;
$$;
grant execute on function public.storage_first_uuid(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Quejas de cliente (ESC-SGC-FR-002)
-- ---------------------------------------------------------------------------
create sequence public.quejas_seq;
create table public.quejas (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique default ('QC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quejas_seq')::text, 4, '0')),
  fecha_recepcion date not null default public.local_today(),
  via_recepcion text not null check (via_recepcion in ('telefono', 'correo', 'whatsapp', 'visita', 'sitio_web', 'otro')),
  responsable_nombre text check (responsable_nombre is null or length(responsable_nombre) <= 120),
  customer_id uuid references public.customers (id),
  cliente_nombre text not null check (length(trim(cliente_nombre)) between 2 and 200),
  contacto_nombre text check (contacto_nombre is null or length(contacto_nombre) <= 150),
  contacto_medio text check (contacto_medio is null or length(contacto_medio) <= 200),
  referencia text check (referencia is null or length(referencia) <= 200),
  descripcion text not null check (length(trim(descripcion)) between 5 and 4000),
  vendedor_id uuid references public.profiles (id),
  estado text not null default 'abierta' check (estado in ('abierta', 'en_analisis', 'con_sac', 'cerrada')),
  solucion text check (solucion is null or length(solucion) <= 4000),
  cerrada_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quejas_vendedor_idx on public.quejas (vendedor_id, estado);

-- ---------------------------------------------------------------------------
-- 3) Solicitud de accion correctiva (ESC-SGC-FR-001)
-- ---------------------------------------------------------------------------
create sequence public.sac_seq;
create table public.acciones_correctivas (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique default ('SAC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sac_seq')::text, 3, '0')),
  fecha date not null default public.local_today(),
  solicitante text not null check (length(trim(solicitante)) between 2 and 150),
  codigo_control text check (codigo_control is null or length(codigo_control) <= 80),
  clausula text check (clausula is null or length(clausula) <= 80),
  fuente text not null check (fuente in ('revision_gerencial', 'queja_cliente', 'satisfaccion_cliente', 'auditoria',
                                         'requisito_legal', 'producto_no_conforme', 'simulacro', 'otro')),
  fuente_otro text check (fuente_otro is null or length(fuente_otro) <= 150),
  queja_id uuid references public.quejas (id),
  descripcion text not null check (length(trim(descripcion)) between 5 and 4000),
  equipo jsonb not null default '[]' check (jsonb_typeof(equipo) = 'array'),
  correccion text check (correccion is null or length(correccion) <= 2000),
  contencion text check (contencion is null or length(contencion) <= 2000),
  consecuencia text check (consecuencia is null or length(consecuencia) <= 2000),
  objetivo text check (objetivo is null or length(objetivo) <= 2000),
  causas jsonb not null default '{}' check (jsonb_typeof(causas) = 'object'),
  causa_raiz text check (causa_raiz is null or length(causa_raiz) <= 2000),
  procesos_afectados text check (procesos_afectados is null or length(procesos_afectados) <= 1000),
  actualizar_riesgos boolean,
  plan jsonb not null default '[]' check (jsonb_typeof(plan) = 'array'),
  plan_crea_riesgo boolean,
  plan_observaciones text check (plan_observaciones is null or length(plan_observaciones) <= 2000),
  verificacion jsonb not null default '[]' check (jsonb_typeof(verificacion) = 'array'),
  verificacion_observaciones text check (verificacion_observaciones is null or length(verificacion_observaciones) <= 2000),
  cumple_objetivo boolean,
  alternativa text check (alternativa is null or length(alternativa) <= 2000),
  fecha_cierre date,
  estado text not null default 'abierta' check (estado in ('abierta', 'en_proceso', 'verificacion', 'cerrada', 'cancelada')),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fuente <> 'otro' or fuente_otro is not null),
  check (estado <> 'cerrada' or fecha_cierre is not null)
);
create index sac_queja_idx on public.acciones_correctivas (queja_id) where queja_id is not null;

create table public.calidad_eventos (
  id uuid primary key default gen_random_uuid(),
  queja_id uuid references public.quejas (id),
  sac_id uuid references public.acciones_correctivas (id),
  tipo text not null check (tipo in ('alta', 'estado', 'comentario', 'sac', 'archivo')),
  nota text check (nota is null or length(nota) <= 2000),
  autor_nombre text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((queja_id is null) <> (sac_id is null))
);
create index calidad_eventos_idx on public.calidad_eventos (queja_id, sac_id, created_at desc);

create table public.calidad_archivos (
  id uuid primary key default gen_random_uuid(),
  queja_id uuid references public.quejas (id),
  sac_id uuid references public.acciones_correctivas (id),
  nombre text not null check (length(nombre) <= 200),
  path text not null unique,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  check ((queja_id is null) <> (sac_id is null))
);

create or replace function public.can_read_queja(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or (public.is_seller() and exists (
    select 1 from public.quejas q where q.id = p_id and (q.vendedor_id = auth.uid() or q.created_by = auth.uid())
  ));
$$;
create or replace function public.can_read_sac(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_reader() or (public.is_seller() and exists (
    select 1 from public.acciones_correctivas a join public.quejas q on q.id = a.queja_id
     where a.id = p_id and (q.vendedor_id = auth.uid() or q.created_by = auth.uid())
  ));
$$;
-- Puede comentar y subir evidencia a la queja: su vendedor (si sigue abierta) o el coordinador ISO.
create or replace function public.can_write_queja(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_iso() or (public.is_seller() and exists (
    select 1 from public.quejas q where q.id = p_id and (q.vendedor_id = auth.uid() or q.created_by = auth.uid())
  ));
$$;
grant execute on function public.can_read_queja(uuid), public.can_read_sac(uuid), public.can_write_queja(uuid) to authenticated;

-- Alta: el vendedor queda como responsable; avisa al coordinador ISO.
create or replace function public.quejas_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.responsable_nombre := coalesce(nullif(trim(new.responsable_nombre), ''), public.my_name());
    if public.is_seller() then new.vendedor_id := auth.uid(); end if;  -- el coordinador ISO elige el vendedor
    new.estado := 'abierta';
    new.solucion := null;
  end if;
  if TG_OP = 'UPDATE' then
    if not public.is_iso() then
      if new.estado is distinct from old.estado then raise exception 'Solo el coordinador ISO cambia el estatus de la queja'; end if;
      new.solucion := old.solucion;
      new.vendedor_id := old.vendedor_id;
    end if;
    if new.estado is distinct from old.estado then
      new.cerrada_at := case when new.estado = 'cerrada' then now() end;
    end if;
  end if;
  return new;
end $$;
create trigger quejas_before before insert or update on public.quejas
  for each row execute function public.quejas_before();
create or replace function public.quejas_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_link text := '/calidad/quejas/' || new.id;
  label constant jsonb := '{"abierta":"Abierta","en_analisis":"En analisis","con_sac":"Con accion correctiva","cerrada":"Cerrada"}';
begin
  if TG_OP = 'INSERT' then
    insert into public.calidad_eventos (queja_id, tipo, nota) values (new.id, 'alta', null);
    perform public.notify_role('coordinador_iso', 'queja_nueva', 'Nueva queja ' || new.numero || ': ' || new.cliente_nombre,
                               left(new.descripcion, 140), v_link, new.id);
  elsif new.estado is distinct from old.estado then
    insert into public.calidad_eventos (queja_id, tipo, nota)
    values (new.id, 'estado', (label ->> new.estado) || coalesce(': ' || nullif(trim(new.solucion), ''), ''));
    perform public.notify_user(new.vendedor_id, 'queja_estado', 'Queja ' || new.numero || ': ' || (label ->> new.estado),
                               new.cliente_nombre, v_link, new.id);
  end if;
  return null;
end $$;
create trigger quejas_after after insert or update on public.quejas
  for each row execute function public.quejas_after();

create or replace function public.sac_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then new.created_by := auth.uid(); end if;
  if new.estado = 'cerrada' and new.fecha_cierre is null then new.fecha_cierre := public.local_today(); end if;
  return new;
end $$;
create trigger sac_before before insert or update on public.acciones_correctivas
  for each row execute function public.sac_before();
create or replace function public.sac_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_q public.quejas;
  label constant jsonb := '{"abierta":"Abierta","en_proceso":"Plan de accion en proceso","verificacion":"En verificacion","cerrada":"Cerrada","cancelada":"Cancelada"}';
begin
  if TG_OP = 'INSERT' then
    insert into public.calidad_eventos (sac_id, tipo) values (new.id, 'alta');
  elsif new.estado is distinct from old.estado then
    insert into public.calidad_eventos (sac_id, tipo, nota) values (new.id, 'estado', label ->> new.estado);
  end if;
  if new.queja_id is not null and (TG_OP = 'INSERT' or new.queja_id is distinct from old.queja_id) then
    select * into v_q from public.quejas where id = new.queja_id;
    update public.quejas set estado = 'con_sac' where id = new.queja_id and estado in ('abierta', 'en_analisis');
    insert into public.calidad_eventos (queja_id, tipo, nota) values (new.queja_id, 'sac', new.numero);
    perform public.notify_user(v_q.vendedor_id, 'sac_nueva', 'Accion correctiva ' || new.numero || ' por la queja ' || v_q.numero,
                               v_q.cliente_nombre, '/calidad/sac/' || new.id, new.id);
  elsif new.queja_id is not null and TG_OP = 'UPDATE' and new.estado is distinct from old.estado then
    select * into v_q from public.quejas where id = new.queja_id;
    perform public.notify_user(v_q.vendedor_id, 'sac_estado', 'Accion correctiva ' || new.numero || ': ' || (label ->> new.estado),
                               v_q.cliente_nombre, '/calidad/sac/' || new.id, new.id);
  end if;
  return null;
end $$;
create trigger sac_after after insert or update on public.acciones_correctivas
  for each row execute function public.sac_after();

create trigger quejas_updated before update on public.quejas for each row execute function public.set_updated_at();
create trigger sac_updated before update on public.acciones_correctivas for each row execute function public.set_updated_at();
create trigger quejas_no_delete before delete on public.quejas for each row execute function public.forbid_mutation();
create trigger sac_no_delete before delete on public.acciones_correctivas for each row execute function public.forbid_mutation();
create trigger quejas_audit after insert or update on public.quejas for each row execute function public.audit_row();
create trigger sac_audit after insert or update on public.acciones_correctivas for each row execute function public.audit_row();
create trigger calidad_eventos_autor before insert on public.calidad_eventos for each row execute function public.set_autor();
create trigger calidad_eventos_immutable before update or delete on public.calidad_eventos for each row execute function public.forbid_mutation();
create trigger calidad_archivos_immutable before update or delete on public.calidad_archivos for each row execute function public.forbid_mutation();
create trigger calidad_archivos_audit after insert on public.calidad_archivos for each row execute function public.audit_row();

alter table public.quejas enable row level security;
alter table public.acciones_correctivas enable row level security;
alter table public.calidad_eventos enable row level security;
alter table public.calidad_archivos enable row level security;
revoke all on public.quejas, public.acciones_correctivas, public.calidad_eventos, public.calidad_archivos from anon, authenticated;
grant usage on sequence public.quejas_seq, public.sac_seq to authenticated;
grant select on public.quejas, public.acciones_correctivas, public.calidad_eventos, public.calidad_archivos to authenticated;
grant insert (id, fecha_recepcion, via_recepcion, responsable_nombre, customer_id, cliente_nombre, contacto_nombre,
              contacto_medio, referencia, descripcion, vendedor_id) on public.quejas to authenticated;
grant update (fecha_recepcion, via_recepcion, responsable_nombre, customer_id, cliente_nombre, contacto_nombre,
              contacto_medio, referencia, descripcion, vendedor_id, estado, solucion) on public.quejas to authenticated;
grant insert (id, fecha, solicitante, codigo_control, clausula, fuente, fuente_otro, queja_id, descripcion, equipo, correccion,
              contencion, consecuencia, objetivo, causas, causa_raiz, procesos_afectados, actualizar_riesgos, plan,
              plan_crea_riesgo, plan_observaciones, verificacion, verificacion_observaciones, cumple_objetivo, alternativa,
              fecha_cierre, estado) on public.acciones_correctivas to authenticated;
grant update (fecha, solicitante, codigo_control, clausula, fuente, fuente_otro, queja_id, descripcion, equipo, correccion,
              contencion, consecuencia, objetivo, causas, causa_raiz, procesos_afectados, actualizar_riesgos, plan,
              plan_crea_riesgo, plan_observaciones, verificacion, verificacion_observaciones, cumple_objetivo, alternativa,
              fecha_cierre, estado) on public.acciones_correctivas to authenticated;
grant insert (id, queja_id, sac_id, tipo, nota) on public.calidad_eventos to authenticated;
grant insert (id, queja_id, sac_id, nombre, path) on public.calidad_archivos to authenticated;

create policy quejas_select on public.quejas for select to authenticated
  using (public.is_buyer() or public.is_sales_reader()
         or (public.is_seller() and (vendedor_id = auth.uid() or created_by = auth.uid())));
create policy quejas_insert on public.quejas for insert to authenticated
  with check (public.is_seller() or public.is_iso());
-- El vendedor corrige los datos mientras la queja siga abierta; el coordinador ISO edita siempre.
create policy quejas_update_seller on public.quejas for update to authenticated
  using (public.is_seller() and created_by = auth.uid() and estado = 'abierta')
  with check (public.is_seller() and created_by = auth.uid());
create policy quejas_update_iso on public.quejas for update to authenticated
  using (public.is_iso()) with check (public.is_iso());
create policy sac_select on public.acciones_correctivas for select to authenticated
  using (public.can_read_sac(id));
create policy sac_insert on public.acciones_correctivas for insert to authenticated with check (public.is_iso());
create policy sac_update on public.acciones_correctivas for update to authenticated
  using (public.is_iso()) with check (public.is_iso());
create policy calidad_eventos_select on public.calidad_eventos for select to authenticated
  using ((queja_id is not null and public.can_read_queja(queja_id)) or (sac_id is not null and public.can_read_sac(sac_id)));
create policy calidad_eventos_insert on public.calidad_eventos for insert to authenticated
  with check (tipo = 'comentario' and (
    (queja_id is not null and public.can_write_queja(queja_id))
    or (sac_id is not null and public.is_iso())));
create policy calidad_archivos_select on public.calidad_archivos for select to authenticated
  using ((queja_id is not null and public.can_read_queja(queja_id)) or (sac_id is not null and public.can_read_sac(sac_id)));
create policy calidad_archivos_insert on public.calidad_archivos for insert to authenticated
  with check (created_by = auth.uid() and (
    (queja_id is not null and public.can_write_queja(queja_id) and path like queja_id::text || '/%')
    or (sac_id is not null and public.is_iso() and path like sac_id::text || '/%')));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('calidad', 'calidad', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy calidad_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'calidad' and (public.can_read_queja(public.storage_first_uuid(name))
                                    or public.can_read_sac(public.storage_first_uuid(name))));
create policy calidad_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'calidad' and (public.can_write_queja(public.storage_first_uuid(name))
                                         or (public.is_iso() and exists (select 1 from public.acciones_correctivas a
                                                                          where a.id = public.storage_first_uuid(name)))));

-- ---------------------------------------------------------------------------
-- 4) Consumo interno
-- ---------------------------------------------------------------------------
create sequence public.consumo_seq;
create table public.consumo_solicitudes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique default ('CI-' || lpad(nextval('public.consumo_seq')::text, 4, '0')),
  solicitante_id uuid not null default auth.uid() references public.profiles (id),
  solicitante_nombre text,
  tipo text not null check (tipo in ('producto', 'servicio')),
  categoria text not null check (categoria in ('papeleria', 'limpieza', 'cafeteria', 'vehiculo', 'equipo', 'mantenimiento', 'otro')),
  descripcion text not null check (length(trim(descripcion)) between 2 and 500),
  cantidad numeric(12, 2) not null check (cantidad > 0),
  unidad text check (unidad is null or length(unidad) <= 40),
  motivo text not null check (length(trim(motivo)) between 3 and 1000),
  urgente boolean not null default false,
  estado text not null default 'por_aprobar'
    check (estado in ('por_aprobar', 'aprobada', 'rechazada', 'en_proceso', 'completada', 'cancelada')),
  aprobada_por uuid references public.profiles (id),
  aprobada_nombre text,
  aprobada_at timestamptz,
  rechazo_motivo text check (rechazo_motivo is null or length(rechazo_motivo) <= 500),
  compra_nota text check (compra_nota is null or length(compra_nota) <= 1000),
  fecha_programada date,
  completada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consumo_estado_idx on public.consumo_solicitudes (estado, created_at desc);
create index consumo_solicitante_idx on public.consumo_solicitudes (solicitante_id, created_at desc);

create table public.consumo_eventos (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.consumo_solicitudes (id),
  tipo text not null check (tipo in ('alta', 'aprobada', 'rechazada', 'en_proceso', 'completada', 'cancelada', 'comentario')),
  nota text check (nota is null or length(nota) <= 1000),
  autor_nombre text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index consumo_eventos_idx on public.consumo_eventos (solicitud_id, created_at desc);

create or replace function public.can_read_consumo(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.consumo_solicitudes c
     where c.id = p_id and (
       c.solicitante_id = auth.uid() or public.is_sales_manager() or public.is_gerente() or public.is_iso()
       or (public.is_buyer() and c.aprobada_at is not null and c.estado not in ('por_aprobar', 'rechazada'))));
$$;
grant execute on function public.can_read_consumo(uuid) to authenticated;

-- La jefa de ventas y la gerente no necesitan aprobacion de nadie para lo suyo.
create or replace function public.consumo_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.solicitante_id := auth.uid();
    new.solicitante_nombre := public.my_name();
    if public.is_sales_manager() or public.is_gerente() then
      new.estado := 'aprobada'; new.aprobada_por := auth.uid(); new.aprobada_nombre := new.solicitante_nombre; new.aprobada_at := now();
    else
      new.estado := 'por_aprobar';
    end if;
  elsif new.estado is distinct from old.estado and current_setting('esc.consumo_rpc', true) is distinct from '1' then
    raise exception 'El estatus solo cambia con los botones del portal';
  end if;
  return new;
end $$;
create trigger consumo_before before insert or update on public.consumo_solicitudes
  for each row execute function public.consumo_before();
create or replace function public.consumo_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_link text := '/consumo/' || new.id; v_t text := new.numero || ': ' || new.descripcion;
begin
  if TG_OP = 'INSERT' then
    insert into public.consumo_eventos (solicitud_id, tipo, nota) values (new.id, 'alta', null);
    if new.estado = 'por_aprobar' then
      perform public.notify_role('jefe_ventas', 'consumo_por_aprobar', 'Por aprobar ' || v_t, new.solicitante_nombre || ': ' || new.motivo, v_link, new.id);
    else
      perform public.notify_role('comprador', 'consumo_aprobado', 'Consumo interno ' || v_t, new.solicitante_nombre || ': ' || new.motivo, v_link, new.id);
    end if;
  end if;
  return null;
end $$;
create trigger consumo_after after insert on public.consumo_solicitudes
  for each row execute function public.consumo_after();

-- Aprobar o rechazar (jefa de ventas)
create or replace function public.consumo_aprobar(p_id uuid, p_aprobar boolean, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.consumo_solicitudes;
begin
  if not public.is_sales_manager() then raise exception 'Solo la jefa de ventas aprueba' using errcode = '42501'; end if;
  select * into v from public.consumo_solicitudes where id = p_id for update;
  if v.id is null or v.estado <> 'por_aprobar' then raise exception 'Esta solicitud ya no esta por aprobar'; end if;
  if not p_aprobar and coalesce(trim(p_nota), '') = '' then raise exception 'Escribe el motivo del rechazo'; end if;
  perform set_config('esc.consumo_rpc', '1', true);
  update public.consumo_solicitudes
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         aprobada_por = auth.uid(), aprobada_nombre = public.my_name(), aprobada_at = now(),
         rechazo_motivo = case when p_aprobar then null else left(trim(p_nota), 500) end
   where id = p_id;
  perform set_config('esc.consumo_rpc', '', true);
  insert into public.consumo_eventos (solicitud_id, tipo, nota)
  values (p_id, case when p_aprobar then 'aprobada' else 'rechazada' end, nullif(left(trim(coalesce(p_nota, '')), 1000), ''));
  perform public.notify_user(v.solicitante_id, 'consumo_' || case when p_aprobar then 'aprobado' else 'rechazado' end,
    v.numero || case when p_aprobar then ' aprobada' else ' rechazada' end, v.descripcion, '/consumo/' || p_id, p_id);
  if p_aprobar then
    perform public.notify_role('comprador', 'consumo_aprobado', 'Consumo interno ' || v.numero || ': ' || v.descripcion,
                               v.solicitante_nombre || ': ' || v.motivo, '/consumo/' || p_id, p_id);
  end if;
end $$;

-- Avance del comprador: en proceso (pedido o agendado) y completada (recibido o realizado).
create or replace function public.consumo_avance(p_id uuid, p_estado text, p_fecha date default null, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.consumo_solicitudes;
begin
  if not public.is_buyer() then raise exception 'Solo el comprador marca el avance' using errcode = '42501'; end if;
  if p_estado not in ('en_proceso', 'completada') then raise exception 'Estatus invalido'; end if;
  select * into v from public.consumo_solicitudes where id = p_id for update;
  if v.id is null or v.estado not in ('aprobada', 'en_proceso') then raise exception 'Esta solicitud no esta aprobada o ya se cerro'; end if;
  perform set_config('esc.consumo_rpc', '1', true);
  update public.consumo_solicitudes
     set estado = p_estado,
         fecha_programada = coalesce(p_fecha, fecha_programada),
         compra_nota = coalesce(nullif(left(trim(coalesce(p_nota, '')), 1000), ''), compra_nota),
         completada_at = case when p_estado = 'completada' then now() end
   where id = p_id;
  perform set_config('esc.consumo_rpc', '', true);
  insert into public.consumo_eventos (solicitud_id, tipo, nota)
  values (p_id, p_estado, nullif(concat_ws(' · ', case when p_fecha is not null then 'Fecha: ' || to_char(p_fecha, 'DD/MM/YYYY') end,
                                           nullif(trim(coalesce(p_nota, '')), '')), ''));
  perform public.notify_user(v.solicitante_id, 'consumo_' || p_estado,
    v.numero || case when p_estado = 'completada' then (case when v.tipo = 'servicio' then ' realizada' else ' recibida' end)
                     else (case when v.tipo = 'servicio' then ' agendada' else ' pedida' end) end,
    v.descripcion, '/consumo/' || p_id, p_id);
end $$;

-- Cancelar: quien la pidio (antes de que el comprador la mueva) o el comprador.
create or replace function public.consumo_cancelar(p_id uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.consumo_solicitudes;
begin
  select * into v from public.consumo_solicitudes where id = p_id for update;
  if v.id is null then raise exception 'Solicitud no encontrada'; end if;
  if not ((v.solicitante_id = auth.uid() and v.estado in ('por_aprobar', 'aprobada'))
          or (public.is_buyer() and v.estado in ('aprobada', 'en_proceso'))) then
    raise exception 'No puedes cancelar esta solicitud' using errcode = '42501';
  end if;
  perform set_config('esc.consumo_rpc', '1', true);
  update public.consumo_solicitudes set estado = 'cancelada' where id = p_id;
  perform set_config('esc.consumo_rpc', '', true);
  insert into public.consumo_eventos (solicitud_id, tipo, nota) values (p_id, 'cancelada', nullif(left(trim(coalesce(p_nota, '')), 1000), ''));
  perform public.notify_user(v.solicitante_id, 'consumo_cancelada', v.numero || ' cancelada', v.descripcion, '/consumo/' || p_id, p_id);
end $$;

create trigger consumo_updated before update on public.consumo_solicitudes for each row execute function public.set_updated_at();
create trigger consumo_no_delete before delete on public.consumo_solicitudes for each row execute function public.forbid_mutation();
create trigger consumo_audit after insert or update on public.consumo_solicitudes for each row execute function public.audit_row();
create trigger consumo_eventos_autor before insert on public.consumo_eventos for each row execute function public.set_autor();
create trigger consumo_eventos_immutable before update or delete on public.consumo_eventos for each row execute function public.forbid_mutation();

alter table public.consumo_solicitudes enable row level security;
alter table public.consumo_eventos enable row level security;
revoke all on public.consumo_solicitudes, public.consumo_eventos from anon, authenticated;
grant usage on sequence public.consumo_seq to authenticated;
grant select on public.consumo_solicitudes, public.consumo_eventos to authenticated;
grant insert (id, tipo, categoria, descripcion, cantidad, unidad, motivo, urgente) on public.consumo_solicitudes to authenticated;
grant update (tipo, categoria, descripcion, cantidad, unidad, motivo, urgente) on public.consumo_solicitudes to authenticated;
grant insert (id, solicitud_id, tipo, nota) on public.consumo_eventos to authenticated;
grant execute on function public.consumo_aprobar(uuid, boolean, text), public.consumo_avance(uuid, text, date, text),
  public.consumo_cancelar(uuid, text) to authenticated;

create policy consumo_select on public.consumo_solicitudes for select to authenticated
  using (solicitante_id = auth.uid() or public.can_read_consumo(id));
-- Pide cualquiera del equipo menos el comprador (el comprador es quien compra).
create policy consumo_insert on public.consumo_solicitudes for insert to authenticated
  with check (public.is_active_user() and not public.is_buyer());
create policy consumo_update on public.consumo_solicitudes for update to authenticated
  using (solicitante_id = auth.uid() and estado = 'por_aprobar') with check (solicitante_id = auth.uid());
create policy consumo_eventos_select on public.consumo_eventos for select to authenticated using (public.can_read_consumo(solicitud_id));
create policy consumo_eventos_insert on public.consumo_eventos for insert to authenticated
  with check (tipo = 'comentario' and public.can_read_consumo(solicitud_id)
              and (public.is_buyer() or public.is_sales_manager()
                   or exists (select 1 from public.consumo_solicitudes c where c.id = solicitud_id and c.solicitante_id = auth.uid())));

-- ---------------------------------------------------------------------------
-- 5) Guias de paqueteria
-- ---------------------------------------------------------------------------
create sequence public.guias_seq;
create table public.guias (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique default ('G-' || lpad(nextval('public.guias_seq')::text, 4, '0')),
  vendedor_id uuid not null default auth.uid() references public.profiles (id),
  vendedor_nombre text,
  factura text not null check (length(trim(factura)) between 1 and 60),
  destinatario text not null check (length(trim(destinatario)) between 2 and 200),
  paqueteria text not null check (paqueteria in ('DHL', 'FedEx', 'Estafeta', 'Paquetexpress', 'UPS', 'Redpack', '99 Minutos',
                                                 'Castores', 'Tres Guerras', 'Otra')),
  paqueteria_otra text check (paqueteria_otra is null or length(paqueteria_otra) <= 80),
  servicio text not null default 'estandar' check (servicio in ('estandar', 'express', 'dia_siguiente', 'economico')),
  customer_id uuid references public.customers (id),
  contacto_nombre text check (contacto_nombre is null or length(contacto_nombre) <= 150),
  telefono text not null check (length(trim(telefono)) between 7 and 40),
  correo text check (correo is null or length(correo) <= 150),
  calle_numero text not null check (length(trim(calle_numero)) between 3 and 250),
  colonia text check (colonia is null or length(colonia) <= 150),
  cp text not null check (cp ~ '^[0-9]{5}$'),
  ciudad text not null check (length(trim(ciudad)) between 2 and 120),
  estado_geo text not null check (length(trim(estado_geo)) between 2 and 60),
  referencias text check (referencias is null or length(referencias) <= 300),
  bultos integer not null default 1 check (bultos between 1 and 999),
  peso_kg numeric(10, 2) not null check (peso_kg > 0),
  largo_cm numeric(8, 1) check (largo_cm is null or largo_cm > 0),
  ancho_cm numeric(8, 1) check (ancho_cm is null or ancho_cm > 0),
  alto_cm numeric(8, 1) check (alto_cm is null or alto_cm > 0),
  contenido text check (contenido is null or length(contenido) <= 300),
  valor_declarado numeric(14, 2) check (valor_declarado is null or valor_declarado >= 0),
  asegurar boolean not null default false,
  urgente boolean not null default false,
  notas text check (notas is null or length(notas) <= 1000),
  estado text not null default 'solicitada' check (estado in ('solicitada', 'en_proceso', 'requiere_datos', 'lista', 'cancelada')),
  solicitada_at timestamptz not null default now(),
  atendida_por uuid references public.profiles (id),
  atendida_nombre text,
  tomada_at timestamptz,
  mensaje text check (mensaje is null or length(mensaje) <= 1000),
  numero_rastreo text check (numero_rastreo is null or length(numero_rastreo) <= 80),
  archivo_path text,
  archivo_nombre text,
  lista_at timestamptz,
  recordatorios integer not null default 0,
  ultimo_recordatorio_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paqueteria <> 'Otra' or paqueteria_otra is not null),
  check (estado <> 'lista' or archivo_path is not null)
);
create index guias_vendedor_idx on public.guias (vendedor_id, created_at desc);
create index guias_estado_idx on public.guias (estado, solicitada_at);

create table public.guia_eventos (
  id uuid primary key default gen_random_uuid(),
  guia_id uuid not null references public.guias (id),
  tipo text not null check (tipo in ('alta', 'en_proceso', 'requiere_datos', 'reenviada', 'lista', 'cancelada', 'recordatorio', 'comentario')),
  nota text check (nota is null or length(nota) <= 1000),
  autor_nombre text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index guia_eventos_idx on public.guia_eventos (guia_id, created_at desc);

create or replace function public.can_read_guia(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_marketplaces() or public.is_buyer() or public.is_sales_reader() or exists (
    select 1 from public.guias g where g.id = p_id and g.vendedor_id = auth.uid());
$$;
grant execute on function public.can_read_guia(uuid) to authenticated;

create or replace function public.guias_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.vendedor_id := auth.uid();
    new.vendedor_nombre := public.my_name();
    new.estado := 'solicitada';
    new.solicitada_at := now();
  elsif current_setting('esc.guia_rpc', true) is distinct from '1' then
    if new.estado is distinct from old.estado then raise exception 'El estatus solo cambia con los botones del portal'; end if;
    -- El vendedor corrige los datos que pidio Marketplaces: vuelve a la fila de solicitudes.
    if old.estado = 'requiere_datos' then
      new.estado := 'solicitada';
      new.solicitada_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger guias_before before insert or update on public.guias
  for each row execute function public.guias_before();
create or replace function public.guias_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_t text := new.factura || ' · ' || new.destinatario || ' · ' || coalesce(new.paqueteria_otra, new.paqueteria);
begin
  if TG_OP = 'INSERT' then
    insert into public.guia_eventos (guia_id, tipo) values (new.id, 'alta');
    perform public.notify_role('marketplaces', 'guia_nueva', case when new.urgente then 'URGENTE: ' else '' end || 'Guia ' || v_t,
                               'Pide ' || new.vendedor_nombre, '/guias/' || new.id, new.id);
  elsif old.estado = 'requiere_datos' and new.estado = 'solicitada' then
    insert into public.guia_eventos (guia_id, tipo) values (new.id, 'reenviada');
    perform public.notify_user(new.atendida_por, 'guia_reenviada', 'Datos corregidos: ' || v_t, null, '/guias/' || new.id, new.id);
  end if;
  return null;
end $$;
create trigger guias_after after insert or update on public.guias
  for each row execute function public.guias_after();

-- Marketplaces: tomar, pedir datos, subir la guia.
create or replace function public.guia_mover(p_id uuid, p_estado text, p_nota text default null,
                                             p_rastreo text default null, p_path text default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias; v_t text;
begin
  if not public.is_marketplaces() then raise exception 'Solo Marketplaces atiende las guias' using errcode = '42501'; end if;
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.estado = 'cancelada' then raise exception 'Guia no disponible'; end if;
  v_t := v.factura || ' · ' || v.destinatario || ' · ' || coalesce(v.paqueteria_otra, v.paqueteria);
  perform set_config('esc.guia_rpc', '1', true);
  if p_estado = 'en_proceso' then
    if v.estado <> 'solicitada' then raise exception 'La guia ya fue tomada'; end if;
    update public.guias set estado = 'en_proceso', atendida_por = auth.uid(), atendida_nombre = public.my_name(), tomada_at = now() where id = p_id;
    perform public.notify_user(v.vendedor_id, 'guia_en_proceso', 'Generando guia ' || v_t, public.my_name(), '/guias/' || p_id, p_id);
  elsif p_estado = 'requiere_datos' then
    if v.estado not in ('solicitada', 'en_proceso') then raise exception 'No se puede pedir datos en este paso'; end if;
    if coalesce(trim(p_nota), '') = '' then raise exception 'Escribe que dato falta'; end if;
    update public.guias set estado = 'requiere_datos', mensaje = left(trim(p_nota), 1000),
           atendida_por = coalesce(atendida_por, auth.uid()), atendida_nombre = coalesce(atendida_nombre, public.my_name()) where id = p_id;
    perform public.notify_user(v.vendedor_id, 'guia_requiere_datos', 'Faltan datos en la guia ' || v_t, left(trim(p_nota), 200), '/guias/' || p_id, p_id);
  elsif p_estado = 'lista' then
    if v.estado not in ('solicitada', 'en_proceso', 'lista') then raise exception 'No se puede subir la guia en este paso'; end if;
    if p_path is null or p_path not like p_id::text || '/%' then raise exception 'Sube el archivo de la guia'; end if;
    update public.guias set estado = 'lista', archivo_path = p_path, archivo_nombre = left(coalesce(p_nombre, 'guia.pdf'), 200),
           numero_rastreo = coalesce(nullif(left(trim(coalesce(p_rastreo, '')), 80), ''), numero_rastreo), lista_at = now(),
           atendida_por = coalesce(atendida_por, auth.uid()), atendida_nombre = coalesce(atendida_nombre, public.my_name()), mensaje = null
     where id = p_id;
    perform public.notify_user(v.vendedor_id, 'guia_lista', 'Guia lista: ' || v_t,
                               coalesce('Rastreo ' || nullif(trim(coalesce(p_rastreo, '')), ''), 'Ya puedes descargarla'), '/guias/' || p_id, p_id);
  else
    raise exception 'Paso invalido';
  end if;
  perform set_config('esc.guia_rpc', '', true);
  insert into public.guia_eventos (guia_id, tipo, nota)
  values (p_id, p_estado, nullif(concat_ws(' · ', case when p_estado = 'lista' then 'Rastreo: ' || nullif(trim(coalesce(p_rastreo, '')), '') end,
                                           nullif(trim(coalesce(p_nota, '')), '')), ''));
end $$;

-- Vendedor: recordar a Marketplaces (a partir de 4 horas y maximo uno por hora) y cancelar.
create or replace function public.guia_recordar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias;
begin
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.vendedor_id <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v.estado not in ('solicitada', 'en_proceso') then raise exception 'Esta guia no esta pendiente'; end if;
  if now() - v.solicitada_at < interval '4 hours' then raise exception 'Podras recordar cuando pasen 4 horas desde la solicitud'; end if;
  if v.ultimo_recordatorio_at is not null and now() - v.ultimo_recordatorio_at < interval '1 hour' then
    raise exception 'Ya enviaste un recordatorio hace menos de una hora';
  end if;
  perform set_config('esc.guia_rpc', '1', true);
  update public.guias set recordatorios = recordatorios + 1, ultimo_recordatorio_at = now() where id = p_id;
  perform set_config('esc.guia_rpc', '', true);
  insert into public.guia_eventos (guia_id, tipo) values (p_id, 'recordatorio');
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  select id, 'guia_recordatorio', left('Recordatorio: guia ' || v.factura || ' · ' || v.destinatario || ' · ' || coalesce(v.paqueteria_otra, v.paqueteria), 200),
         'Solicitada por ' || v.vendedor_nombre || ' hace ' || floor(extract(epoch from now() - v.solicitada_at) / 3600)::int || ' horas',
         '/guias/' || p_id, p_id
    from public.profiles where rol = 'marketplaces' and activo;
end $$;

create or replace function public.guia_cancelar(p_id uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias;
begin
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.vendedor_id <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v.estado in ('lista', 'cancelada') then raise exception 'Esta guia ya no se puede cancelar'; end if;
  perform set_config('esc.guia_rpc', '1', true);
  update public.guias set estado = 'cancelada' where id = p_id;
  perform set_config('esc.guia_rpc', '', true);
  insert into public.guia_eventos (guia_id, tipo, nota) values (p_id, 'cancelada', nullif(left(trim(coalesce(p_nota, '')), 1000), ''));
  perform public.notify_user(v.atendida_por, 'guia_cancelada', 'Guia cancelada: ' || v.factura || ' · ' || v.destinatario, null, '/guias/' || p_id, p_id);
end $$;

-- Mensajes entre vendedor y Marketplaces: avisan a la otra parte.
create or replace function public.guia_eventos_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v public.guias;
begin
  if new.tipo = 'comentario' then
    select * into v from public.guias where id = new.guia_id;
    if auth.uid() = v.vendedor_id then
      if v.atendida_por is not null then
        perform public.notify_user(v.atendida_por, 'guia_mensaje', 'Mensaje en guia ' || v.factura || ' · ' || v.destinatario, left(new.nota, 200), '/guias/' || v.id, new.id);
      else
        perform public.notify_role('marketplaces', 'guia_mensaje', 'Mensaje en guia ' || v.factura || ' · ' || v.destinatario, left(new.nota, 200), '/guias/' || v.id, new.id);
      end if;
    else
      perform public.notify_user(v.vendedor_id, 'guia_mensaje', 'Mensaje en guia ' || v.factura || ' · ' || v.destinatario, left(new.nota, 200), '/guias/' || v.id, new.id);
    end if;
  end if;
  return null;
end $$;
create trigger guia_eventos_after after insert on public.guia_eventos for each row execute function public.guia_eventos_after();

create trigger guias_updated before update on public.guias for each row execute function public.set_updated_at();
create trigger guias_no_delete before delete on public.guias for each row execute function public.forbid_mutation();
create trigger guias_audit after insert or update on public.guias for each row execute function public.audit_row();
create trigger guia_eventos_autor before insert on public.guia_eventos for each row execute function public.set_autor();
create trigger guia_eventos_immutable before update or delete on public.guia_eventos for each row execute function public.forbid_mutation();

alter table public.guias enable row level security;
alter table public.guia_eventos enable row level security;
revoke all on public.guias, public.guia_eventos from anon, authenticated;
grant usage on sequence public.guias_seq to authenticated;
grant select on public.guias, public.guia_eventos to authenticated;
grant insert (id, factura, destinatario, paqueteria, paqueteria_otra, servicio, customer_id, contacto_nombre, telefono, correo,
              calle_numero, colonia, cp, ciudad, estado_geo, referencias, bultos, peso_kg, largo_cm, ancho_cm, alto_cm,
              contenido, valor_declarado, asegurar, urgente, notas) on public.guias to authenticated;
grant update (factura, destinatario, paqueteria, paqueteria_otra, servicio, customer_id, contacto_nombre, telefono, correo,
              calle_numero, colonia, cp, ciudad, estado_geo, referencias, bultos, peso_kg, largo_cm, ancho_cm, alto_cm,
              contenido, valor_declarado, asegurar, urgente, notas) on public.guias to authenticated;
grant insert (id, guia_id, tipo, nota) on public.guia_eventos to authenticated;
grant execute on function public.guia_mover(uuid, text, text, text, text, text), public.guia_recordar(uuid),
  public.guia_cancelar(uuid, text) to authenticated;

create policy guias_select on public.guias for select to authenticated
  using (vendedor_id = auth.uid() or public.can_read_guia(id));
create policy guias_insert on public.guias for insert to authenticated with check (public.is_seller());
create policy guias_update on public.guias for update to authenticated
  using (public.is_seller() and vendedor_id = auth.uid() and estado in ('solicitada', 'requiere_datos'))
  with check (vendedor_id = auth.uid());
create policy guia_eventos_select on public.guia_eventos for select to authenticated using (public.can_read_guia(guia_id));
create policy guia_eventos_insert on public.guia_eventos for insert to authenticated
  with check (tipo = 'comentario' and (public.is_marketplaces()
              or exists (select 1 from public.guias g where g.id = guia_id and g.vendedor_id = auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guias', 'guias', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy guias_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'guias' and public.can_read_guia(public.storage_first_uuid(name)));
create policy guias_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'guias' and public.is_marketplaces()
              and exists (select 1 from public.guias g where g.id = public.storage_first_uuid(name)));

-- Permisos de funciones internas
revoke all on function public.quejas_before(), public.quejas_after(), public.sac_before(), public.sac_after(),
  public.consumo_before(), public.consumo_after(), public.guias_before(), public.guias_after(), public.guia_eventos_after(),
  public.set_autor() from public, anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select count(*) from information_schema.tables where table_schema = 'public' and table_name in
--     ('quejas', 'acciones_correctivas', 'calidad_eventos', 'calidad_archivos', 'consumo_solicitudes',
--      'consumo_eventos', 'guias', 'guia_eventos');                                                -- 8
--   select id from storage.buckets where id in ('calidad', 'guias');                              -- 2 filas
-- -----------------------------------------------------------------------------
