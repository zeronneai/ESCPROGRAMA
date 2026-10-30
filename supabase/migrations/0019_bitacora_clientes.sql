-- =============================================================================
-- 0019_bitacora_clientes.sql   (requiere 0018_rol_jefe_ventas.sql YA aplicado)
-- Que hace (todo con bitacora de auditoria; nada se borra):
--   * JEFA DE VENTAS (rol jefe_ventas): ve, de todos los vendedores, las solicitudes enviadas (sin costos),
--     la bitacora de ventas/prospeccion, los leads y la base de clientes. No ve costos ni proveedores.
--   * CLIENTES: estatus Cliente o Prospecto (tipo), giro y estado de la republica. Se guarda con que
--     estatus nacio (tipo_inicial) y cuando y quien lo convirtio a cliente (convertido_at/por) para medir
--     cuantos prospectos se vuelven clientes. Solo comprador o jefa regresan un cliente a prospecto.
--   * PRIVACIDAD: el vendedor ya NO ve la lista completa de clientes; solo los suyos (los que dio de alta,
--     los de sus solicitudes y su bitacora) y los que encuentra con buscar_clientes() (minimo 2 letras,
--     maximo 10 resultados).
--   * BITACORA DE VENTAS Y PROSPECCION (formato ESC-VEN-FR-002): un registro por cliente/oportunidad con
--     las etapas del formato (catalogo, necesidad, muestra, solicitud a compras, cotizacion, orden de
--     compra, facturacion, entrega, cobranza y cartera). Si el cliente es Prospecto aparece en Prospeccion;
--     al marcarlo Cliente pasa a Ventas. bitacora_eventos guarda cada avance y comentario (solo insercion).
--   * AUTOMATICO DESDE EL PORTAL: al enviar una solicitud se crea (o se liga) el registro de bitacora del
--     vendedor con ese cliente; al registrar la cotizacion enviada se llena la fecha de cotizacion; al marcar
--     una partida Ganada se llena la fecha de orden de compra (si estaban vacias).
--   * LEADS: los leads existentes se copian a la bitacora (Prospeccion) con sus contactos como comentarios.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Jefa de ventas
-- ---------------------------------------------------------------------------
create or replace function public.is_sales_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and activo and not must_change_password and rol = 'jefe_ventas'
  );
$$;
grant execute on function public.is_sales_manager() to authenticated;

create or replace function public.can_read_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.quote_requests r
     where r.id = p_request
       and ((r.vendedor_id = auth.uid())
            or ((public.is_buyer() or public.is_sales_manager()) and r.estado = 'enviada'))
  );
$$;

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_buyer() or public.is_sales_manager());

drop policy requests_select on public.quote_requests;
create policy requests_select on public.quote_requests for select to authenticated
  using (public.is_active_user() and
         (vendedor_id = auth.uid() or ((public.is_buyer() or public.is_sales_manager()) and estado = 'enviada')));

drop policy leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated
  using (public.is_sales_manager() or (public.is_seller() and (vendedor_id = auth.uid() or vendedor_id is null)));
create or replace function public.can_read_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_sales_manager() or (public.is_seller() and exists (
    select 1 from public.leads l where l.id = p_lead and (l.vendedor_id = auth.uid() or l.vendedor_id is null)
  ));
$$;

-- ---------------------------------------------------------------------------
-- 2) Clientes: estatus, giro, estado y conversion
-- ---------------------------------------------------------------------------
alter table public.customers
  add column giro text check (giro is null or length(giro) <= 150),
  add column estado_geo text check (estado_geo is null or length(estado_geo) <= 60),
  add column tipo_inicial public.customer_kind,
  add column convertido_at timestamptz,
  add column convertido_por uuid references public.profiles (id);
update public.customers set tipo_inicial = tipo where tipo_inicial is null;
alter table public.customers alter column tipo_inicial set not null;

grant insert (giro, estado_geo) on public.customers to authenticated;
grant update (giro, estado_geo) on public.customers to authenticated;

create or replace function public.customers_tipo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.giro := nullif(trim(coalesce(new.giro, '')), '');
  new.estado_geo := nullif(trim(coalesce(new.estado_geo, '')), '');
  if TG_OP = 'INSERT' then
    new.tipo_inicial := new.tipo;
    new.convertido_at := null;
    new.convertido_por := null;
    return new;
  end if;
  new.tipo_inicial := old.tipo_inicial;
  if new.tipo is distinct from old.tipo then
    if new.tipo = 'cliente' then
      new.convertido_at := now();
      new.convertido_por := auth.uid();
    else
      if not (public.is_buyer() or public.is_sales_manager()) then
        raise exception 'Solo el comprador o la jefa de ventas pueden regresar un cliente a prospecto';
      end if;
      new.convertido_at := null;
      new.convertido_por := null;
    end if;
  else
    new.convertido_at := old.convertido_at;
    new.convertido_por := old.convertido_por;
  end if;
  return new;
end $$;
create trigger customers_tipo_guard before insert or update on public.customers
  for each row execute function public.customers_tipo_guard();

-- ---------------------------------------------------------------------------
-- 3) Bitacora de ventas y prospeccion
-- ---------------------------------------------------------------------------
create type public.bitacora_resultado as enum ('abierta', 'ganada', 'perdida');

create table public.bitacora (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid references public.profiles (id),          -- null = sin asignar (sitio web)
  customer_id uuid not null references public.customers (id),
  request_id uuid references public.quote_requests (id),
  necesidad text check (necesidad is null or length(necesidad) <= 1000),
  fecha_catalogo date,
  fecha_muestra date,
  muestra_no_aplica boolean not null default false,
  fecha_solicitud_compras date,
  fecha_cotizacion date,
  fecha_pedido date,
  facturacion text check (facturacion is null or facturacion in ('contado', 'credito')),
  fecha_factura date,
  monto_venta numeric(14, 2) check (monto_venta is null or monto_venta >= 0),
  moneda public.currency not null default 'MXN',
  porcentaje_cobranza numeric(5, 2) check (porcentaje_cobranza is null or porcentaje_cobranza between 0 and 100),
  fecha_entrega date,
  cartera_dias_vencidos integer check (cartera_dias_vencidos is null or cartera_dias_vencidos >= 0),
  cartera_monto numeric(14, 2) check (cartera_monto is null or cartera_monto >= 0),
  comentarios text check (comentarios is null or length(comentarios) <= 4000),
  proximo_seguimiento date,
  resultado public.bitacora_resultado not null default 'abierta',
  motivo_perdida text check (motivo_perdida is null or length(motivo_perdida) <= 300),
  origen text not null default 'vendedor' check (origen in ('vendedor', 'portal', 'sitio_web', 'lead')),
  externo_id text unique check (externo_id is null or length(externo_id) <= 120),
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (resultado <> 'perdida' or motivo_perdida is not null)
);
create index bitacora_vendedor_idx on public.bitacora (vendedor_id, resultado) where archived_at is null;
create index bitacora_customer_idx on public.bitacora (customer_id);
create index bitacora_request_idx on public.bitacora (request_id) where request_id is not null;

create table public.bitacora_eventos (
  id uuid primary key default gen_random_uuid(),
  bitacora_id uuid not null references public.bitacora (id),
  tipo text not null check (tipo in ('alta', 'etapa', 'comentario', 'resultado', 'estatus_cliente')),
  etapa text,
  nota text check (nota is null or length(nota) <= 2000),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index bitacora_eventos_idx on public.bitacora_eventos (bitacora_id, created_at desc);
create index bitacora_eventos_autor_idx on public.bitacora_eventos (created_by, created_at);

create trigger bitacora_updated before update on public.bitacora
  for each row execute function public.set_updated_at();
create trigger bitacora_no_delete before delete on public.bitacora
  for each row execute function public.forbid_mutation();
create trigger bitacora_audit after insert or update on public.bitacora
  for each row execute function public.audit_row();
create trigger bitacora_eventos_immutable before update or delete on public.bitacora_eventos
  for each row execute function public.forbid_mutation();

-- Cada fecha de etapa capturada (o cambiada) y cada cambio de resultado queda como evento.
create or replace function public.bitacora_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cols text[] := array['fecha_catalogo', 'fecha_muestra', 'fecha_solicitud_compras', 'fecha_cotizacion',
                       'fecha_pedido', 'fecha_factura', 'fecha_entrega'];
  c text; n jsonb := to_jsonb(new); o jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by) values (new.id, 'alta', new.origen, auth.uid());
  else
    o := to_jsonb(old);
  end if;
  foreach c in array cols loop
    if n ->> c is not null and (o is null or (n ->> c) is distinct from (o ->> c)) then
      insert into public.bitacora_eventos (bitacora_id, tipo, etapa, nota, created_by)
      values (new.id, 'etapa', c, n ->> c, auth.uid());
    end if;
  end loop;
  if (o is null and new.porcentaje_cobranza is not null) or (o is not null and new.porcentaje_cobranza is distinct from old.porcentaje_cobranza and new.porcentaje_cobranza is not null) then
    insert into public.bitacora_eventos (bitacora_id, tipo, etapa, nota, created_by) values (new.id, 'etapa', 'cobranza', new.porcentaje_cobranza::text || '%', auth.uid());
  end if;
  if o is not null and new.resultado is distinct from old.resultado then
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    values (new.id, 'resultado', new.resultado::text || coalesce(': ' || new.motivo_perdida, ''), auth.uid());
  end if;
  return null;
end $$;
create trigger bitacora_log after insert or update on public.bitacora
  for each row execute function public.bitacora_log();

-- Visibilidad y escritura
create or replace function public.can_read_bitacora(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_manager() or (public.is_seller() and exists (
    select 1 from public.bitacora b where b.id = p_id and (b.vendedor_id = auth.uid() or b.vendedor_id is null)
  ));
$$;
create or replace function public.can_write_bitacora(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() and exists (select 1 from public.bitacora b where b.id = p_id and b.vendedor_id = auth.uid());
$$;

alter table public.bitacora enable row level security;
alter table public.bitacora_eventos enable row level security;
revoke all on public.bitacora, public.bitacora_eventos from anon, authenticated;
grant select on public.bitacora, public.bitacora_eventos to authenticated;
grant insert (id, vendedor_id, customer_id, request_id, necesidad, fecha_catalogo, fecha_muestra, muestra_no_aplica,
              fecha_solicitud_compras, fecha_cotizacion, fecha_pedido, facturacion, fecha_factura, monto_venta, moneda,
              porcentaje_cobranza, fecha_entrega, cartera_dias_vencidos, cartera_monto, comentarios, proximo_seguimiento,
              resultado, motivo_perdida, created_by)
  on public.bitacora to authenticated;
grant update (vendedor_id, customer_id, request_id, necesidad, fecha_catalogo, fecha_muestra, muestra_no_aplica,
              fecha_solicitud_compras, fecha_cotizacion, fecha_pedido, facturacion, fecha_factura, monto_venta, moneda,
              porcentaje_cobranza, fecha_entrega, cartera_dias_vencidos, cartera_monto, comentarios, proximo_seguimiento,
              resultado, motivo_perdida, archived_at)
  on public.bitacora to authenticated;
grant insert (id, bitacora_id, tipo, nota, created_by) on public.bitacora_eventos to authenticated;
grant execute on function public.can_read_bitacora(uuid), public.can_write_bitacora(uuid) to authenticated;

create policy bitacora_select on public.bitacora for select to authenticated
  using (public.is_buyer() or public.is_sales_manager()
         or (public.is_seller() and (vendedor_id = auth.uid() or vendedor_id is null)));
create policy bitacora_insert on public.bitacora for insert to authenticated
  with check (public.is_seller() and vendedor_id = auth.uid() and created_by = auth.uid());
create policy bitacora_update on public.bitacora for update to authenticated
  using (public.is_seller() and (vendedor_id = auth.uid() or vendedor_id is null))
  with check (public.is_seller() and vendedor_id = auth.uid());
create policy bitacora_eventos_select on public.bitacora_eventos for select to authenticated
  using (public.can_read_bitacora(bitacora_id));
create policy bitacora_eventos_insert on public.bitacora_eventos for insert to authenticated
  with check (public.can_write_bitacora(bitacora_id) and created_by = auth.uid() and tipo = 'comentario');

-- ---------------------------------------------------------------------------
-- 4) Privacidad de clientes para vendedores y buscador
-- ---------------------------------------------------------------------------
create or replace function public.can_see_customer(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_buyer() or public.is_sales_manager() or (public.is_seller() and exists (
    select 1 from public.customers c
     where c.id = p_id and (
       c.created_by = auth.uid()
       or exists (select 1 from public.quote_requests r where r.customer_id = c.id and r.vendedor_id = auth.uid())
       or exists (select 1 from public.bitacora b where b.customer_id = c.id and (b.vendedor_id = auth.uid() or b.vendedor_id is null))
       or exists (select 1 from public.leads l where l.customer_id = c.id and (l.vendedor_id = auth.uid() or l.vendedor_id is null))
     )
  ));
$$;
grant execute on function public.can_see_customer(uuid) to authenticated;

drop policy customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.can_see_customer(id)));
drop policy customers_update_seller on public.customers;
create policy customers_update_seller on public.customers for update to authenticated
  using (public.is_seller() and (created_by = auth.uid() or public.can_see_customer(id))) with check (public.is_seller());
create policy customers_update_manager on public.customers for update to authenticated
  using (public.is_sales_manager()) with check (public.is_sales_manager());

-- Buscador: cualquier usuario activo encuentra clientes por nombre, razon social, RFC, contacto, telefono o correo.
create or replace function public.buscar_clientes(p_q text, p_limit integer default 8)
returns table (
  id uuid, nombre text, razon_social text, rfc text, direccion text, giro text, estado_geo text,
  contacto_nombre text, contacto_telefono text, contacto_correo text, tipo public.customer_kind, activo boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v text := lower(trim(coalesce(p_q, ''))); v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
begin
  if not public.is_active_user() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if length(v) < 2 then return; end if;
  return query
    select c.id, c.nombre, c.razon_social, c.rfc, c.direccion, c.giro, c.estado_geo,
           c.contacto_nombre, c.contacto_telefono, c.contacto_correo, c.tipo, c.activo
      from public.customers c
     where c.activo
       and (lower(c.nombre) like '%' || v || '%'
            or lower(coalesce(c.razon_social, '')) like '%' || v || '%'
            or lower(coalesce(c.rfc, '')) like '%' || v || '%'
            or lower(coalesce(c.contacto_nombre, '')) like '%' || v || '%'
            or lower(coalesce(c.contacto_correo, '')) like '%' || v || '%'
            or (length(v_digits) >= 4 and regexp_replace(coalesce(c.contacto_telefono, ''), '\D', '', 'g') like '%' || v_digits || '%'))
     order by (lower(c.nombre) like v || '%') desc, similarity(lower(c.nombre), v) desc, c.nombre
     limit greatest(1, least(coalesce(p_limit, 8), 10));
end $$;
revoke all on function public.buscar_clientes(text, integer) from public, anon;
grant execute on function public.buscar_clientes(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Llenado automatico desde el portal
-- ---------------------------------------------------------------------------
create or replace function public.local_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.app_settings limit 1), 'America/Chihuahua'))::date;
$$;

-- Al enviar una solicitud: liga (o crea) el registro de bitacora de ese vendedor con ese cliente.
create or replace function public.bitacora_on_request_submit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_need text;
begin
  if not (old.estado = 'borrador' and new.estado = 'enviada') then return null; end if;
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
create trigger quote_requests_bitacora after update on public.quote_requests
  for each row execute function public.bitacora_on_request_submit();

create or replace function public.bitacora_on_issue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.bitacora set fecha_cotizacion = public.local_today()
   where request_id = new.request_id and fecha_cotizacion is null;
  return null;
end $$;
create trigger quote_issues_bitacora after insert on public.quote_issues
  for each row execute function public.bitacora_on_issue();

create or replace function public.bitacora_on_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.resultado = 'ganada' then
    update public.bitacora set fecha_pedido = public.local_today()
     where request_id = public.item_request_id(new.item_id) and fecha_pedido is null;
  end if;
  return null;
end $$;
create trigger item_outcomes_bitacora after insert or update on public.item_outcomes
  for each row execute function public.bitacora_on_outcome();

-- Cambiar el estatus del cliente queda en la bitacora de sus registros.
create or replace function public.customers_tipo_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo is distinct from old.tipo then
    insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by)
    select b.id, 'estatus_cliente', case when new.tipo = 'cliente' then 'Prospecto convertido a cliente' else 'Cliente regresado a prospecto' end, auth.uid()
      from public.bitacora b where b.customer_id = new.id and b.archived_at is null;
  end if;
  return null;
end $$;
create trigger customers_tipo_log after update on public.customers
  for each row execute function public.customers_tipo_log();

-- ---------------------------------------------------------------------------
-- 6) Leads existentes -> Prospeccion (se copian; la tabla leads se conserva tal cual)
-- ---------------------------------------------------------------------------
do $$
declare l record; v_customer uuid; v_b uuid; a record;
  label constant jsonb := '{"llamada":"Llamada","whatsapp":"WhatsApp","correo":"Correo","visita":"Visita","reunion":"Reunion","muestra":"Muestra enviada","cotizacion":"Cotizacion enviada","nota":"Nota"}';
begin
  for l in select * from public.leads order by created_at loop
    v_customer := l.customer_id;
    if v_customer is null then
      select id into v_customer from public.customers where lower(trim(nombre)) = lower(trim(l.empresa)) limit 1;
    end if;
    if v_customer is null then
      insert into public.customers (nombre, tipo, giro, direccion, contacto_nombre, contacto_telefono, contacto_correo, created_by)
      values (trim(l.empresa), case when l.etapa = 'ganado' then 'cliente' else 'prospecto' end::public.customer_kind,
              l.industria, l.ciudad, l.contacto_nombre, l.telefono, l.correo, coalesce(l.created_by, l.vendedor_id))
      returning id into v_customer;
    end if;
    insert into public.bitacora (vendedor_id, customer_id, necesidad, comentarios, proximo_seguimiento, resultado, motivo_perdida,
                                 origen, archived_at, created_by, created_at)
    values (l.vendedor_id, v_customer, l.producto_interes, l.notas, l.proximo_seguimiento,
            case l.etapa when 'ganado' then 'ganada' when 'perdido' then 'perdida' else 'abierta' end::public.bitacora_resultado,
            case when l.etapa = 'perdido' then coalesce(l.motivo_perdida, 'Sin motivo') end,
            'lead', l.archived_at, coalesce(l.created_by, l.vendedor_id), l.created_at)
    returning id into v_b;
    for a in select * from public.lead_activities where lead_id = l.id and tipo <> 'cambio_etapa' order by created_at loop
      insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by, created_at)
      values (v_b, 'comentario', left(coalesce(label ->> a.tipo::text, a.tipo::text) || coalesce(' (' || a.resultado || ')', '') || coalesce(': ' || a.nota, ''), 2000),
              a.created_by, a.created_at);
    end loop;
  end loop;
end $$;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select to_regclass('public.bitacora') is not null and to_regclass('public.bitacora_eventos') is not null as tablas;  -- true
--   select column_name from information_schema.columns where table_name = 'customers'
--      and column_name in ('giro', 'estado_geo', 'tipo_inicial', 'convertido_at', 'convertido_por');                 -- 5 filas
--   select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in
--      ('is_sales_manager', 'buscar_clientes', 'can_see_customer', 'bitacora_on_request_submit');                      -- 4 filas
--   select count(*) as leads, (select count(*) from public.bitacora where origen = 'lead') as copiados from public.leads;  -- iguales
-- -----------------------------------------------------------------------------
