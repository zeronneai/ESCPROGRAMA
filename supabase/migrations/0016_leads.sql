-- =============================================================================
-- 0016_leads.sql
-- Que hace: modulo de LEADS (prospectos) SOLO PARA VENDEDORES.
--   * leads: un prospecto por fila (empresa, contacto, producto de interes, origen, etapa,
--     prioridad, valor estimado, proximo seguimiento). Nunca se borra: se archiva.
--   * lead_activities: bitacora de contactos (llamada, WhatsApp, correo, visita, reunion, muestra,
--     cotizacion, nota) y cambios de etapa. Solo insercion (no se edita ni se borra).
--   * Reglas automaticas: el primer contacto pasa un lead "nuevo" a "contactado"; cada contacto
--     actualiza "ultimo contacto"; cada cambio de etapa queda como actividad.
--   * Leads sin vendedor (vendedor_id null, por ejemplo los que lleguen del formulario del sitio web)
--     los ven todos los vendedores y cualquiera puede tomarlos ("Tomar lead").
--   * convert_lead_to_customer(): convierte el lead en cliente (reutiliza el cliente si ya existe
--     con el mismo nombre) y lo marca como ganado.
--   * RLS: cada vendedor ve y edita solo sus leads (y los sin asignar). El comprador no tiene acceso.
--   * Todo cambio queda en la bitacora de auditoria (audit_row).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0001 a 0015.
-- =============================================================================

begin;

create type public.lead_stage as enum
  ('nuevo', 'contactado', 'interesado', 'cotizando', 'negociacion', 'ganado', 'perdido');
create type public.lead_source as enum
  ('llamada_fria', 'referido', 'sitio_web', 'whatsapp', 'correo', 'redes_sociales', 'expo_evento',
   'visita', 'cliente_existente', 'otro');
create type public.lead_activity_kind as enum
  ('llamada', 'whatsapp', 'correo', 'visita', 'reunion', 'muestra', 'cotizacion', 'nota', 'cambio_etapa');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid references public.profiles (id),
  empresa text not null check (length(trim(empresa)) between 2 and 200),
  contacto_nombre text check (contacto_nombre is null or length(contacto_nombre) <= 150),
  contacto_puesto text check (contacto_puesto is null or length(contacto_puesto) <= 120),
  telefono text check (telefono is null or length(telefono) <= 40),
  correo text check (correo is null or (length(correo) <= 200 and correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ciudad text check (ciudad is null or length(ciudad) <= 120),
  industria text check (industria is null or length(industria) <= 120),
  producto_interes text check (producto_interes is null or length(producto_interes) <= 500),
  origen public.lead_source not null default 'llamada_fria',
  origen_detalle text check (origen_detalle is null or length(origen_detalle) <= 300),
  etapa public.lead_stage not null default 'nuevo',
  prioridad text not null default 'media' check (prioridad in ('baja', 'media', 'alta')),
  valor_estimado numeric(14, 2) check (valor_estimado is null or valor_estimado >= 0),
  moneda public.currency not null default 'MXN',
  proximo_seguimiento date,
  ultimo_contacto_at timestamptz,
  motivo_perdida text check (motivo_perdida is null or length(motivo_perdida) <= 300),
  notas text check (notas is null or length(notas) <= 4000),
  customer_id uuid references public.customers (id),
  -- Identificador del sistema externo (formulario web) para no duplicar envios.
  externo_id text unique check (externo_id is null or length(externo_id) <= 120),
  etapa_at timestamptz not null default now(),
  ganado_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (etapa <> 'perdido' or motivo_perdida is not null)
);
create index leads_vendedor_idx on public.leads (vendedor_id, etapa) where archived_at is null;
create index leads_seguimiento_idx on public.leads (proximo_seguimiento) where archived_at is null;

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id),
  tipo public.lead_activity_kind not null,
  resultado text check (resultado is null or length(resultado) <= 120),
  nota text check (nota is null or length(nota) <= 2000),
  etapa_antes public.lead_stage,
  etapa_despues public.lead_stage,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);
create index lead_activities_autor_idx on public.lead_activities (created_by, created_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger leads_updated before update on public.leads
  for each row execute function public.set_updated_at();
create trigger leads_no_delete before delete on public.leads
  for each row execute function public.forbid_mutation();
create trigger leads_audit after insert or update or delete on public.leads
  for each row execute function public.audit_row();
create trigger lead_activities_immutable before update or delete on public.lead_activities
  for each row execute function public.forbid_mutation();
create trigger lead_activities_audit after insert or update or delete on public.lead_activities
  for each row execute function public.audit_row();

-- Cambio de etapa: fecha de etapa, fecha de ganado y motivo de perdida coherentes.
create or replace function public.lead_before_update() returns trigger
language plpgsql as $$
begin
  if new.etapa is distinct from old.etapa then
    new.etapa_at := now();
    if new.etapa = 'ganado' then new.ganado_at := coalesce(new.ganado_at, now()); end if;
    if old.etapa = 'ganado' and new.etapa <> 'ganado' then new.ganado_at := null; end if;
    if new.etapa <> 'perdido' then new.motivo_perdida := null; end if;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.externo_id := old.externo_id;
  return new;
end $$;
create trigger leads_before_update before update on public.leads
  for each row execute function public.lead_before_update();

-- Cada cambio de etapa queda como actividad (para la linea de tiempo y el embudo).
create or replace function public.lead_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.etapa is distinct from old.etapa then
    insert into public.lead_activities (lead_id, tipo, etapa_antes, etapa_despues, nota, created_by)
    values (new.id, 'cambio_etapa', old.etapa, new.etapa,
            case when new.etapa = 'perdido' then new.motivo_perdida end, auth.uid());
  end if;
  return null;
end $$;
create trigger leads_after_update after update on public.leads
  for each row execute function public.lead_after_update();

-- Un contacto real actualiza "ultimo contacto" y pasa el lead de "nuevo" a "contactado".
create or replace function public.lead_activity_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo in ('llamada', 'whatsapp', 'correo', 'visita', 'reunion', 'muestra', 'cotizacion') then
    update public.leads
       set ultimo_contacto_at = greatest(coalesce(ultimo_contacto_at, new.created_at), new.created_at),
           etapa = case when etapa = 'nuevo' then 'contactado'::public.lead_stage else etapa end
     where id = new.lead_id;
  end if;
  return null;
end $$;
create trigger lead_activities_after_insert after insert on public.lead_activities
  for each row execute function public.lead_activity_after_insert();

-- ---------------------------------------------------------------------------
-- Seguridad (RLS): solo vendedores. Cada quien lo suyo y lo que no tiene dueno.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() and exists (
    select 1 from public.leads l where l.id = p_lead and (l.vendedor_id = auth.uid() or l.vendedor_id is null)
  );
$$;
create or replace function public.can_write_lead(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() and exists (
    select 1 from public.leads l where l.id = p_lead and l.vendedor_id = auth.uid()
  );
$$;

alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
revoke all on public.leads, public.lead_activities from anon, authenticated;
grant select on public.leads, public.lead_activities to authenticated;
grant insert (id, vendedor_id, empresa, contacto_nombre, contacto_puesto, telefono, correo, ciudad, industria,
              producto_interes, origen, origen_detalle, etapa, prioridad, valor_estimado, moneda,
              proximo_seguimiento, motivo_perdida, notas, created_by)
  on public.leads to authenticated;
grant update (vendedor_id, empresa, contacto_nombre, contacto_puesto, telefono, correo, ciudad, industria,
              producto_interes, origen, origen_detalle, etapa, prioridad, valor_estimado, moneda,
              proximo_seguimiento, motivo_perdida, notas, archived_at)
  on public.leads to authenticated;
grant insert (id, lead_id, tipo, resultado, nota, created_by) on public.lead_activities to authenticated;
grant execute on function public.can_read_lead(uuid), public.can_write_lead(uuid) to authenticated;

create policy leads_select on public.leads for select to authenticated
  using (public.is_seller() and (vendedor_id = auth.uid() or vendedor_id is null));
create policy leads_insert on public.leads for insert to authenticated
  with check (public.is_seller() and vendedor_id = auth.uid() and created_by = auth.uid());
-- Puede editar lo suyo y "tomar" un lead sin dueno; despues de editar siempre queda a su nombre.
create policy leads_update on public.leads for update to authenticated
  using (public.is_seller() and (vendedor_id = auth.uid() or vendedor_id is null))
  with check (public.is_seller() and vendedor_id = auth.uid());

create policy lead_activities_select on public.lead_activities for select to authenticated
  using (public.can_read_lead(lead_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated
  with check (public.can_write_lead(lead_id) and created_by = auth.uid() and tipo <> 'cambio_etapa');

-- ---------------------------------------------------------------------------
-- Convertir a cliente
-- ---------------------------------------------------------------------------
create or replace function public.convert_lead_to_customer(p_lead uuid, p_nombre text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lead public.leads; v_nombre text; v_customer uuid;
begin
  if not public.can_write_lead(p_lead) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into v_lead from public.leads where id = p_lead for update;
  v_nombre := nullif(trim(coalesce(p_nombre, v_lead.empresa)), '');
  if v_nombre is null or length(v_nombre) < 2 then raise exception 'Escribe el nombre de la empresa'; end if;
  v_customer := v_lead.customer_id;
  if v_customer is null then
    select id into v_customer from public.customers where lower(trim(nombre)) = lower(v_nombre) limit 1;
  end if;
  if v_customer is null then
    insert into public.customers (nombre, tipo, contacto_nombre, contacto_correo, contacto_telefono, created_by)
    values (v_nombre, 'cliente', v_lead.contacto_nombre, v_lead.correo, v_lead.telefono, auth.uid())
    returning id into v_customer;
  else
    update public.customers
       set tipo = 'cliente',
           contacto_nombre = coalesce(contacto_nombre, v_lead.contacto_nombre),
           contacto_correo = coalesce(contacto_correo, v_lead.correo),
           contacto_telefono = coalesce(contacto_telefono, v_lead.telefono)
     where id = v_customer;
  end if;
  update public.leads set customer_id = v_customer, etapa = 'ganado' where id = p_lead;
  return v_customer;
end $$;
revoke all on function public.convert_lead_to_customer(uuid, text) from public, anon;
grant execute on function public.convert_lead_to_customer(uuid, text) to authenticated;

-- Vinculo con un cliente existente sin cambiar la etapa (para cotizar a un prospecto).
create or replace function public.link_lead_customer(p_lead uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lead public.leads; v_customer uuid;
begin
  if not public.can_write_lead(p_lead) then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into v_lead from public.leads where id = p_lead for update;
  if v_lead.customer_id is not null then return v_lead.customer_id; end if;
  select id into v_customer from public.customers where lower(trim(nombre)) = lower(trim(v_lead.empresa)) limit 1;
  if v_customer is null then
    insert into public.customers (nombre, tipo, contacto_nombre, contacto_correo, contacto_telefono, created_by)
    values (trim(v_lead.empresa), 'prospecto', v_lead.contacto_nombre, v_lead.correo, v_lead.telefono, auth.uid())
    returning id into v_customer;
  end if;
  update public.leads set customer_id = v_customer where id = p_lead;
  return v_customer;
end $$;
revoke all on function public.link_lead_customer(uuid) from public, anon;
grant execute on function public.link_lead_customer(uuid) to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select to_regclass('public.leads') is not null and to_regclass('public.lead_activities') is not null
--          as tablas_creadas;                                                              -- true
--   select tablename, policyname from pg_policies
--    where tablename in ('leads', 'lead_activities') order by 1, 2;                        -- 5 filas
--   select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in
--    ('convert_lead_to_customer', 'link_lead_customer', 'can_read_lead', 'can_write_lead');  -- 4 filas
-- -----------------------------------------------------------------------------
