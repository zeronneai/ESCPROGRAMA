-- Row Level Security. Principio: todo cerrado por defecto, se abre lo minimo.

-- Helpers de acceso a solicitudes (security definer: sin recursion de RLS).
create or replace function public.can_read_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.quote_requests r
     where r.id = p_request
       and ((r.vendedor_id = auth.uid())
            or (public.is_buyer() and r.estado = 'enviada'))
  );
$$;

create or replace function public.is_own_draft(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() and exists (
    select 1 from public.quote_requests r
     where r.id = p_request and r.vendedor_id = auth.uid() and r.estado = 'borrador'
  );
$$;

create or replace function public.item_request_id(p_item uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select request_id from public.quote_items where id = p_item;
$$;

-- Permisos base: nada para anon, lectura para authenticated (filtrada por RLS).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

grant select on public.profiles, public.app_settings, public.pricing_config, public.holidays,
  public.customers, public.quote_requests, public.quote_items, public.item_references,
  public.item_costs, public.item_quotes, public.item_dispatch, public.notifications,
  public.audit_log to authenticated;
grant execute on function public.is_enabled(), public.is_active_user(), public.is_buyer(), public.is_seller(),
  public.can_read_request(uuid), public.is_own_draft(uuid), public.item_request_id(uuid)
  to authenticated;

grant insert (nombre, tipo, created_by) on public.customers to authenticated;
grant update (nombre, tipo, activo, razon_social, rfc, direccion, contacto_nombre,
  contacto_correo, contacto_telefono) on public.customers to authenticated;
grant insert (vendedor_id, customer_id, notas, estado) on public.quote_requests to authenticated;
grant update (customer_id, notas, estado, due_at, archived_at) on public.quote_requests to authenticated;
grant insert (request_id, posicion, producto, descripcion, cantidad, unidad, talla, notas)
  on public.quote_items to authenticated;
grant update (posicion, producto, descripcion, cantidad, unidad, talla, notas)
  on public.quote_items to authenticated;
grant delete on public.quote_items to authenticated;
grant insert (item_id, tipo, url) on public.item_references to authenticated;
grant delete on public.item_references to authenticated;
grant insert (no_shipping_markup, p1, p2, p3, p4, p5, created_by) on public.pricing_config to authenticated;
grant update (timezone, sla_business_hours, warn_business_hours, updated_by, updated_at)
  on public.app_settings to authenticated;
grant insert, update, delete on public.holidays to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Ejecucion de RPC: solo usuarios autenticados (las funciones validan el rol).
do $$
declare f text;
begin
  foreach f in array array[
    'admin_create_profile(uuid,text,text,public.user_role)',
    'admin_update_user(uuid,text)',
    'admin_set_user_active(uuid,boolean)',
    'admin_flag_password_reset(uuid)',
    'complete_password_change()',
    'touch_login()',
    'log_event(text,text,text,jsonb)',
    'respond_item_quoted(uuid,numeric,numeric,public.currency,jsonb,numeric,numeric,numeric,numeric,numeric,integer,public.delivery_kind,date,numeric,text,numeric,text,text,numeric)',
    'respond_item_not_found(uuid,text,numeric)',
    'mark_item_dispatched(uuid,integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Politicas
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.pricing_config enable row level security;
alter table public.holidays enable row level security;
alter table public.customers enable row level security;
alter table public.folio_counters enable row level security;
alter table public.quote_requests enable row level security;
alter table public.quote_items enable row level security;
alter table public.item_references enable row level security;
alter table public.item_costs enable row level security;
alter table public.item_quotes enable row level security;
alter table public.item_dispatch enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Perfiles: cada quien el suyo; el comprador todos. Escritura solo via RPC.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_buyer());

-- Configuracion
create policy settings_select on public.app_settings for select to authenticated
  using (public.is_active_user());
create policy settings_update on public.app_settings for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Factores del tabulador: el vendedor NO los ve.
create policy pricing_select on public.pricing_config for select to authenticated
  using (public.is_buyer());
create policy pricing_insert on public.pricing_config for insert to authenticated
  with check (public.is_buyer() and created_by = auth.uid());

create policy holidays_select on public.holidays for select to authenticated
  using (public.is_active_user());
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Clientes
create policy customers_select on public.customers for select to authenticated
  using (public.is_active_user());
create policy customers_insert on public.customers for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
create policy customers_update on public.customers for update to authenticated
  using (public.is_buyer()) with check (public.is_buyer());

-- Solicitudes
create policy requests_select on public.quote_requests for select to authenticated
  using (public.is_active_user() and
         (vendedor_id = auth.uid() or (public.is_buyer() and estado = 'enviada')));
create policy requests_insert on public.quote_requests for insert to authenticated
  with check (public.is_seller() and vendedor_id = auth.uid() and estado = 'borrador');
create policy requests_update on public.quote_requests for update to authenticated
  using (public.is_seller() and vendedor_id = auth.uid() and estado = 'borrador')
  with check (vendedor_id = auth.uid());

-- Partidas
create policy items_select on public.quote_items for select to authenticated
  using (public.can_read_request(request_id));
create policy items_insert on public.quote_items for insert to authenticated
  with check (public.is_own_draft(request_id));
create policy items_update on public.quote_items for update to authenticated
  using (public.is_own_draft(request_id)) with check (public.is_own_draft(request_id));
create policy items_delete on public.quote_items for delete to authenticated
  using (public.is_own_draft(request_id));

create policy refs_select on public.item_references for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));
create policy refs_insert on public.item_references for insert to authenticated
  with check (public.is_own_draft(public.item_request_id(item_id)));
create policy refs_delete on public.item_references for delete to authenticated
  using (public.is_own_draft(public.item_request_id(item_id)));

-- COSTOS: solo comprador. El vendedor no tiene ni lectura (privacidad en BD).
create policy costs_select on public.item_costs for select to authenticated
  using (public.is_buyer());

-- Precios finales: comprador y el vendedor dueno de la solicitud.
create policy quotes_select on public.item_quotes for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));
create policy dispatch_select on public.item_dispatch for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

-- Notificaciones propias
create policy notif_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bitacora: solo lectura para el comprador.
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_buyer());
