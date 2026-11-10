-- =============================================================================
-- 0044_analisis_riesgo.sql   (requiere 0043 ya aplicado)
-- ANALISIS Y EVALUACION DE RIESGO (formato de calidad, tipo AMEF) para los jefes de area:
-- Jefa de ventas, Supervisor(a) de finanzas / administracion, Gerente, CEO, Comprador, Almacen,
-- Supervisor de almacen y Coordinador ISO.
--   * Cada analisis es de un proceso (nombre y fecha). Por cada actividad se agregan VARIOS modos de
--     falla, cada uno con sus efectos, clasificacion, severidad, ocurrencia, deteccion, controles,
--     tratamiento (acciones, responsable, fecha) y monitoreo (riesgo residual).
--   * El nivel de riesgo (ROE) = Severidad x Ocurrencia x Deteccion lo calcula el portal.
--   * Cada jefe ve y edita los suyos; el Coordinador ISO, la Gerente y el CEO ven todos (ISO tambien edita).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.puede_analizar_riesgo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.activo
                   and p.rol in ('jefe_ventas', 'supervisor_finanzas', 'gerente', 'ceo', 'comprador', 'almacen', 'supervisor_almacen', 'coordinador_iso'));
$$;
grant execute on function public.puede_analizar_riesgo() to authenticated;

create sequence public.riesgo_seq;
create table public.riesgo_analisis (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique default ('AR-' || lpad(nextval('public.riesgo_seq')::text, 3, '0')),
  proceso text not null check (length(trim(proceso)) between 2 and 200),
  fecha date not null default public.local_today(),
  actividades jsonb not null default '[]'::jsonb
    check (jsonb_typeof(actividades) = 'array' and pg_column_size(actividades) < 600000),
  area text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  autor_nombre text,
  editado_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index riesgo_analisis_autor_idx on public.riesgo_analisis (created_by, fecha desc);

create or replace function public.riesgo_analisis_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.area := (select rol::text from public.profiles where id = auth.uid());
  end if;
  new.editado_nombre := public.my_name();
  return new;
end $$;
create trigger riesgo_analisis_autor before insert on public.riesgo_analisis for each row execute function public.set_autor();
create trigger riesgo_analisis_before before insert or update on public.riesgo_analisis for each row execute function public.riesgo_analisis_before();
create trigger riesgo_analisis_updated before update on public.riesgo_analisis for each row execute function public.set_updated_at();
create trigger riesgo_analisis_audit after insert or update on public.riesgo_analisis for each row execute function public.audit_row();
create trigger riesgo_analisis_no_delete before delete on public.riesgo_analisis for each row execute function public.forbid_mutation();
revoke all on function public.riesgo_analisis_before() from public, anon, authenticated;

alter table public.riesgo_analisis enable row level security;
revoke all on public.riesgo_analisis from anon, authenticated;
grant usage on sequence public.riesgo_seq to authenticated;
grant select on public.riesgo_analisis to authenticated;
grant insert (proceso, fecha, actividades) on public.riesgo_analisis to authenticated;
grant update (proceso, fecha, actividades) on public.riesgo_analisis to authenticated;
create policy riesgo_select on public.riesgo_analisis for select to authenticated
  using (public.is_iso() or public.is_gerente() or (created_by = auth.uid() and public.puede_analizar_riesgo()));
create policy riesgo_insert on public.riesgo_analisis for insert to authenticated with check (public.puede_analizar_riesgo());
create policy riesgo_update on public.riesgo_analisis for update to authenticated
  using ((created_by = auth.uid() and public.puede_analizar_riesgo()) or public.is_iso())
  with check ((created_by = auth.uid() and public.puede_analizar_riesgo()) or public.is_iso());

-- Tiempo real
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'riesgo_analisis') then
    alter publication supabase_realtime add table public.riesgo_analisis;
  end if;
end $$;

commit;
