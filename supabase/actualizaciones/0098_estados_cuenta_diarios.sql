-- =============================================================================
-- 0098_estados_cuenta_diarios.sql   (requiere 0076)
-- RECORDATORIO DIARIO DE ESTADOS DE CUENTA
--  * La auxiliar de finanzas sube cada dia (lunes a viernes, antes de las 9 am) el estado de cuenta de
--    cada una de las cuentas del banco. Le sale una barra roja arriba con las que le faltan hoy.
--  * Las cuentas se toman de los estados de cuenta que ya se subieron; finanzas puede agregar o quitar.
--  * Si una cuenta no tuvo abonos ese dia (no hay nada que subir), finanzas la marca "Sin abonos hoy".
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.conciliacion_cuentas (
  id uuid primary key default gen_random_uuid(),
  banco text not null check (length(trim(banco)) between 1 and 40),
  cuenta text not null unique check (cuenta ~ '^[0-9]{4,20}$'),
  nombre text check (length(nombre) <= 80),
  moneda text not null default 'MXN' check (moneda in ('MXN', 'USD')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.conciliacion_cuentas (banco, cuenta, moneda)
select distinct on (c.cuenta) c.banco, c.cuenta, c.moneda::text from public.conciliaciones c
 where c.cuenta ~ '^[0-9]{4,20}$' order by c.cuenta, c.created_at desc
on conflict (cuenta) do nothing;

alter table public.conciliacion_cuentas enable row level security;
revoke all on public.conciliacion_cuentas from anon, authenticated;
grant select, insert, update, delete on public.conciliacion_cuentas to authenticated;
drop policy if exists conciliacion_cuentas_select on public.conciliacion_cuentas;
create policy conciliacion_cuentas_select on public.conciliacion_cuentas for select to authenticated
  using (public.is_finanzas() or public.is_gerente() or public.is_sales_manager());
drop policy if exists conciliacion_cuentas_write on public.conciliacion_cuentas;
create policy conciliacion_cuentas_write on public.conciliacion_cuentas for all to authenticated
  using (public.is_finanzas() or public.is_gerente()) with check (public.is_finanzas() or public.is_gerente());

-- Dia sin abonos en una cuenta: el estado de cuenta no trae nada que subir; finanzas lo marca.
create table if not exists public.conciliacion_cuentas_dia (
  cuenta_id uuid not null references public.conciliacion_cuentas (id) on delete cascade,
  fecha date not null default public.local_today(),
  por uuid references public.profiles (id) default auth.uid(),
  at timestamptz not null default now(),
  primary key (cuenta_id, fecha)
);
alter table public.conciliacion_cuentas_dia enable row level security;
revoke all on public.conciliacion_cuentas_dia from anon, authenticated;
grant select on public.conciliacion_cuentas_dia to authenticated;
drop policy if exists conciliacion_cuentas_dia_select on public.conciliacion_cuentas_dia;
create policy conciliacion_cuentas_dia_select on public.conciliacion_cuentas_dia for select to authenticated
  using (public.is_finanzas() or public.is_gerente() or public.is_sales_manager());
create or replace function public.estado_cuenta_sin_abonos(p_cuenta uuid, p_quitar boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_finanzas() then raise exception 'Solo finanzas' using errcode = '42501'; end if;
  if p_quitar then
    delete from public.conciliacion_cuentas_dia where cuenta_id = p_cuenta and fecha = public.local_today();
  else
    insert into public.conciliacion_cuentas_dia (cuenta_id) values (p_cuenta) on conflict do nothing;
  end if;
end;
$$;
revoke all on function public.estado_cuenta_sin_abonos(uuid, boolean) from public, anon;
grant execute on function public.estado_cuenta_sin_abonos(uuid, boolean) to authenticated;

-- Cuentas y si ya se subio su estado de cuenta hoy (en fin de semana no pide nada).
create or replace function public.estados_cuenta_hoy()
returns table (id uuid, banco text, cuenta text, nombre text, moneda text, subido boolean, subido_at timestamptz, sin_abonos boolean, habil boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.local_today();
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'America/Chihuahua');
begin
  if not (public.is_finanzas() or public.is_gerente() or public.is_sales_manager()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select k.id, k.banco, k.cuenta, k.nombre, k.moneda,
      s.at is not null or d.cuenta_id is not null, coalesce(s.at, d.at), d.cuenta_id is not null and s.at is null, extract(isodow from v_hoy) < 6
    from public.conciliacion_cuentas k
    left join lateral (
      select max(c.created_at) as at from public.conciliaciones c
       where c.cuenta = k.cuenta and (c.created_at at time zone v_tz)::date = v_hoy
    ) s on true
    left join public.conciliacion_cuentas_dia d on d.cuenta_id = k.id and d.fecha = v_hoy
    where k.activo
    order by k.banco, k.cuenta;
end;
$$;
revoke all on function public.estados_cuenta_hoy() from public, anon;
grant execute on function public.estados_cuenta_hoy() to authenticated;

commit;
