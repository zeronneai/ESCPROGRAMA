-- =============================================================================
-- 0092_rrhh_vacaciones_permisos.sql   (requiere 0033)
-- RECURSOS HUMANOS: VACACIONES Y PERMISOS (formato RR.HH.)
--  * La gerente captura de cada colaborador: fecha de ingreso, puesto, departamento, jefe inmediato y
--    los dias de vacaciones que le quedan HOY (el arranque). De ahi en adelante el portal calcula solo:
--    en cada aniversario suma los dias que marca la Ley Federal del Trabajo (art. 76, "vacaciones
--    dignas": 12, 14, 16, 18, 20, luego +2 cada 5 anios) y resta lo que se autoriza.
--  * La tabla de dias por anio la puede ajustar la gerente (si la empresa da mas que la ley).
--  * Reglas de la gerente: si el sabado es laborable, dias de anticipacion minima y cuantos dias se
--    pueden adelantar (pedir de mas).
--  * Dias festivos (los del formato, ya recorridos) y temporadas de vacaciones generales (Semana
--    Santa, Navidad): la gerente elige que dias de la temporada se descuentan a todos.
--  * Cada colaborador ve sus dias, pide vacaciones o permisos (llegar tarde, salir temprano,
--    ausentarse) y ve el calendario: festivos, temporadas y que dias ya estan ocupados (solo el
--    puesto; la gerente ve el nombre).
--  * Autorizan: el jefe inmediato da el visto bueno y la gerente autoriza.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Reglas y tabla de dias
-- ---------------------------------------------------------------------------
create table if not exists public.rrhh_config (
  id int primary key default 1 check (id = 1),
  sabado_laborable boolean not null default true,
  anticipacion_dias int not null default 0 check (anticipacion_dias between 0 and 90),
  adelanto_max int not null default 0 check (adelanto_max between 0 and 60),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.rrhh_config (id) values (1) on conflict do nothing;

-- Dias de vacaciones por anio cumplido (LFT art. 76, reforma de 2023).
create table if not exists public.rrhh_tabla_dias (
  anios int primary key check (anios between 1 and 60),
  dias int not null check (dias between 0 and 120)
);
insert into public.rrhh_tabla_dias (anios, dias)
select n, case when n <= 5 then 10 + 2 * n else 22 + 2 * ((n - 6) / 5) end from generate_series(1, 40) n
on conflict do nothing;

create table if not exists public.rrhh_festivos (
  fecha date primary key,
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  created_at timestamptz not null default now()
);
-- Los del formato RR.HH. (dia que se descansa, ya recorrido al lunes cuando aplica).
insert into public.rrhh_festivos (fecha, nombre) values
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-02-01', 'Día de la Constitución (5 de febrero)'),
  ('2027-03-15', 'Natalicio de Benito Juárez (21 de marzo)'),
  ('2027-05-01', 'Día del Trabajo'),
  ('2027-06-06', 'Elección federal'),
  ('2027-09-16', 'Día de la Independencia'),
  ('2027-11-15', 'Revolución Mexicana (20 de noviembre)'),
  ('2027-12-25', 'Navidad'),
  ('2028-01-01', 'Año Nuevo'),
  ('2028-02-07', 'Día de la Constitución (5 de febrero)'),
  ('2028-03-20', 'Natalicio de Benito Juárez (21 de marzo)'),
  ('2028-05-01', 'Día del Trabajo'),
  ('2028-09-16', 'Día de la Independencia'),
  ('2028-11-20', 'Revolución Mexicana (20 de noviembre)'),
  ('2028-12-25', 'Navidad'),
  ('2029-01-01', 'Año Nuevo'),
  ('2029-02-05', 'Día de la Constitución (5 de febrero)'),
  ('2029-03-19', 'Natalicio de Benito Juárez (21 de marzo)'),
  ('2029-05-01', 'Día del Trabajo'),
  ('2029-09-16', 'Día de la Independencia'),
  ('2029-11-19', 'Revolución Mexicana (20 de noviembre)'),
  ('2029-12-25', 'Navidad')
on conflict do nothing;

-- Temporadas de vacaciones generales: del rango, la gerente elige que dias se descuentan a todos.
create table if not exists public.rrhh_temporadas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 80),
  desde date not null,
  hasta date not null,
  dias_descuento date[] not null default '{}',
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (hasta >= desde and hasta - desde <= 45)
);
create or replace function public.rrhh_temporada_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from unnest(new.dias_descuento) d where d not between new.desde and new.hasta) then
    raise exception 'Los días a descontar deben estar dentro de la temporada';
  end if;
  new.dias_descuento := coalesce((select array_agg(distinct d order by d) from unnest(new.dias_descuento) d), '{}');
  return new;
end;
$$;
drop trigger if exists rrhh_temporada_check on public.rrhh_temporadas;
create trigger rrhh_temporada_check before insert or update on public.rrhh_temporadas for each row execute function public.rrhh_temporada_check();

-- ---------------------------------------------------------------------------
-- Colaboradores (lo captura la gerente)
-- ---------------------------------------------------------------------------
create table if not exists public.rrhh_empleados (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  fecha_ingreso date not null,
  puesto text check (length(puesto) <= 80),
  departamento text check (length(departamento) <= 80),
  jefe_id uuid references public.profiles (id),
  saldo_inicial numeric(6,1) not null default 0 check (saldo_inicial between -60 and 400),
  saldo_al date not null default public.local_today(),
  saldo_set_at timestamptz not null default now(),
  notas text check (length(notas) <= 500),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  check (jefe_id is distinct from profile_id)
);
create or replace function public.rrhh_empleado_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.saldo_inicial is distinct from old.saldo_inicial or new.saldo_al is distinct from old.saldo_al then
    new.saldo_set_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists rrhh_empleado_trg on public.rrhh_empleados;
create trigger rrhh_empleado_trg before insert or update on public.rrhh_empleados for each row execute function public.rrhh_empleado_trg();

-- ---------------------------------------------------------------------------
-- Solicitudes de vacaciones y permisos
-- ---------------------------------------------------------------------------
create table if not exists public.rrhh_solicitudes (
  id uuid primary key default gen_random_uuid(),
  folio bigint generated always as identity,
  empleado_id uuid not null references public.profiles (id),
  tipo text not null check (tipo in ('vacaciones', 'permiso')),
  permiso_tipo text check (permiso_tipo in ('llegar_tarde', 'salir_temprano', 'ausentarse')),
  desde date not null,
  hasta date not null,
  hora text check (length(hora) <= 40),
  motivo text check (length(motivo) <= 1000),
  dias numeric(5,1) not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'visto_jefe', 'aprobada', 'rechazada', 'cancelada')),
  evidencia_path text check (length(evidencia_path) <= 300),
  evidencia_nombre text check (length(evidencia_nombre) <= 200),
  jefe_id uuid references public.profiles (id),
  jefe_por uuid references public.profiles (id),
  jefe_at timestamptz,
  resuelto_por uuid references public.profiles (id),
  resuelto_at timestamptz,
  comentario text check (length(comentario) <= 500),
  created_at timestamptz not null default now(),
  check (hasta >= desde and hasta - desde <= 60),
  check ((tipo = 'permiso') = (permiso_tipo is not null))
);
create index if not exists rrhh_solicitudes_emp_idx on public.rrhh_solicitudes (empleado_id, desde);
create index if not exists rrhh_solicitudes_rango_idx on public.rrhh_solicitudes (desde, hasta);
drop trigger if exists rrhh_solicitudes_audit on public.rrhh_solicitudes;
create trigger rrhh_solicitudes_audit after insert or update or delete on public.rrhh_solicitudes for each row execute function public.audit_row();
drop trigger if exists rrhh_empleados_audit on public.rrhh_empleados;
create trigger rrhh_empleados_audit after insert or update or delete on public.rrhh_empleados for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Permisos (RLS)
-- ---------------------------------------------------------------------------
alter table public.rrhh_config enable row level security;
alter table public.rrhh_tabla_dias enable row level security;
alter table public.rrhh_festivos enable row level security;
alter table public.rrhh_temporadas enable row level security;
alter table public.rrhh_empleados enable row level security;
alter table public.rrhh_solicitudes enable row level security;
revoke all on public.rrhh_config, public.rrhh_tabla_dias, public.rrhh_festivos, public.rrhh_temporadas,
  public.rrhh_empleados, public.rrhh_solicitudes from anon, authenticated;
grant select, update on public.rrhh_config to authenticated;
grant select, insert, update, delete on public.rrhh_tabla_dias, public.rrhh_festivos, public.rrhh_temporadas, public.rrhh_empleados to authenticated;
grant select on public.rrhh_solicitudes to authenticated;

drop policy if exists rrhh_config_select on public.rrhh_config;
create policy rrhh_config_select on public.rrhh_config for select to authenticated using (public.is_active_user());
drop policy if exists rrhh_config_update on public.rrhh_config;
create policy rrhh_config_update on public.rrhh_config for update to authenticated using (public.is_gerente()) with check (public.is_gerente());

drop policy if exists rrhh_tabla_select on public.rrhh_tabla_dias;
create policy rrhh_tabla_select on public.rrhh_tabla_dias for select to authenticated using (public.is_active_user());
drop policy if exists rrhh_tabla_write on public.rrhh_tabla_dias;
create policy rrhh_tabla_write on public.rrhh_tabla_dias for all to authenticated using (public.is_gerente()) with check (public.is_gerente());

drop policy if exists rrhh_festivos_select on public.rrhh_festivos;
create policy rrhh_festivos_select on public.rrhh_festivos for select to authenticated using (public.is_active_user());
drop policy if exists rrhh_festivos_write on public.rrhh_festivos;
create policy rrhh_festivos_write on public.rrhh_festivos for all to authenticated using (public.is_gerente()) with check (public.is_gerente());

drop policy if exists rrhh_temporadas_select on public.rrhh_temporadas;
create policy rrhh_temporadas_select on public.rrhh_temporadas for select to authenticated using (public.is_active_user());
drop policy if exists rrhh_temporadas_write on public.rrhh_temporadas;
create policy rrhh_temporadas_write on public.rrhh_temporadas for all to authenticated using (public.is_gerente()) with check (public.is_gerente());

drop policy if exists rrhh_empleados_select on public.rrhh_empleados;
create policy rrhh_empleados_select on public.rrhh_empleados for select to authenticated
  using (profile_id = auth.uid() or jefe_id = auth.uid() or public.is_gerente());
drop policy if exists rrhh_empleados_write on public.rrhh_empleados;
create policy rrhh_empleados_write on public.rrhh_empleados for all to authenticated using (public.is_gerente()) with check (public.is_gerente());

drop policy if exists rrhh_solicitudes_select on public.rrhh_solicitudes;
create policy rrhh_solicitudes_select on public.rrhh_solicitudes for select to authenticated
  using (empleado_id = auth.uid() or jefe_id = auth.uid() or public.is_gerente());

-- ---------------------------------------------------------------------------
-- Calculos
-- ---------------------------------------------------------------------------
-- Dia laborable: no domingo, sabado segun la regla, y no festivo.
create or replace function public.rrhh_es_laborable(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(isodow from d) <> 7
     and (extract(isodow from d) <> 6 or coalesce((select sabado_laborable from public.rrhh_config where id = 1), true))
     and not exists (select 1 from public.rrhh_festivos f where f.fecha = d);
$$;

-- Dias que descuenta un rango de vacaciones: laborables que no caen en una temporada general.
create or replace function public.rrhh_dias_rango(p_desde date, p_hasta date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(p_desde, p_hasta, interval '1 day') g(d)
   where public.rrhh_es_laborable(g.d::date)
     and not exists (select 1 from public.rrhh_temporadas t where g.d::date between t.desde and t.hasta);
$$;

-- Dias que tocan al cumplir N anios (segun la tabla; mas alla de la tabla, el ultimo renglon).
create or replace function public.rrhh_dias_ley(p_anios int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_anios is null or p_anios < 1 then 0
    else coalesce((select dias from public.rrhh_tabla_dias where anios = least(p_anios, (select max(anios) from public.rrhh_tabla_dias))), 0) end;
$$;

-- Saldo de vacaciones de un colaborador (no se llama directo).
--   disponible = arranque + dias ganados en aniversarios despues del arranque
--                - vacaciones autorizadas - dias de temporadas generales - solicitudes en espera
create or replace function public.rrhh_saldo_calc(p_emp uuid)
returns table (empleado_id uuid, nombre text, rol text, capturado boolean, fecha_ingreso date, puesto text, departamento text,
  jefe_id uuid, jefe_nombre text, anios int, dias_ley int, proximo_aniversario date, dias_proximo int,
  saldo_inicial numeric, saldo_al date, ganados numeric, usados numeric, temporada numeric, pendientes numeric, disponible numeric,
  permisos_anio int)
language plpgsql stable security definer set search_path = public as $$
declare
  pr public.profiles;
  e public.rrhh_empleados;
  v_hoy date := public.local_today();
  v_anios int;
  v_gan numeric := 0; v_us numeric := 0; v_tmp numeric := 0; v_pen numeric := 0; v_perm int := 0;
begin
  select * into pr from public.profiles where id = p_emp;
  if pr.id is null then return; end if;
  select * into e from public.rrhh_empleados where profile_id = p_emp;
  select count(*)::int into v_perm from public.rrhh_solicitudes s
   where s.empleado_id = p_emp and s.tipo = 'permiso' and s.estado = 'aprobada' and extract(year from s.desde) = extract(year from v_hoy);
  if e.profile_id is null then
    return query select pr.id, pr.nombre, pr.rol::text, false, null::date, null::text, null::text, null::uuid, null::text,
      null::int, null::int, null::date, null::int, null::numeric, null::date, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, v_perm;
    return;
  end if;
  v_anios := extract(year from age(v_hoy, e.fecha_ingreso))::int;
  select coalesce(sum(public.rrhh_dias_ley(k)), 0) into v_gan
    from generate_series(1, greatest(v_anios, 0)) k
   where (e.fecha_ingreso + make_interval(years => k))::date > e.saldo_al;
  select coalesce(sum(s.dias) filter (where s.estado = 'aprobada'), 0), coalesce(sum(s.dias) filter (where s.estado in ('pendiente', 'visto_jefe')), 0)
    into v_us, v_pen
    from public.rrhh_solicitudes s
   where s.empleado_id = p_emp and s.tipo = 'vacaciones' and s.created_at > e.saldo_set_at;
  select count(distinct d) into v_tmp
    from public.rrhh_temporadas t, unnest(t.dias_descuento) d
   where d > e.saldo_al and d >= e.fecha_ingreso and public.rrhh_es_laborable(d);
  return query select pr.id, pr.nombre, pr.rol::text, true, e.fecha_ingreso, e.puesto, e.departamento, e.jefe_id,
    (select j.nombre from public.profiles j where j.id = e.jefe_id), v_anios, public.rrhh_dias_ley(v_anios),
    (e.fecha_ingreso + make_interval(years => v_anios + 1))::date, public.rrhh_dias_ley(v_anios + 1),
    e.saldo_inicial, e.saldo_al, v_gan, v_us, v_tmp, v_pen, e.saldo_inicial + v_gan - v_us - v_tmp - v_pen, v_perm;
end;
$$;
revoke all on function public.rrhh_saldo_calc(uuid) from public, anon, authenticated;

-- Saldos visibles: la gerente (y CEO) ve a todos; el jefe a su equipo; cada quien a si mismo.
create or replace function public.rrhh_saldos()
returns table (empleado_id uuid, nombre text, rol text, capturado boolean, fecha_ingreso date, puesto text, departamento text,
  jefe_id uuid, jefe_nombre text, anios int, dias_ley int, proximo_aniversario date, dias_proximo int,
  saldo_inicial numeric, saldo_al date, ganados numeric, usados numeric, temporada numeric, pendientes numeric, disponible numeric,
  permisos_anio int)
language plpgsql stable security definer set search_path = public as $$
declare v_ger boolean := public.is_gerente();
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select c.* from public.profiles p
    cross join lateral public.rrhh_saldo_calc(p.id) c
    where p.activo and (v_ger or p.id = auth.uid()
      or exists (select 1 from public.rrhh_empleados e where e.profile_id = p.id and e.jefe_id = auth.uid()))
    order by (p.id <> auth.uid()), p.nombre;
end;
$$;
revoke all on function public.rrhh_saldos() from public, anon;
grant execute on function public.rrhh_saldos() to authenticated;

-- Cuantos dias descontaria un rango (para mostrarlo antes de enviar).
create or replace function public.rrhh_contar_dias(p_desde date, p_hasta date) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 60 then return 0; end if;
  return public.rrhh_dias_rango(p_desde, p_hasta);
end;
$$;
revoke all on function public.rrhh_contar_dias(date, date) from public, anon;
grant execute on function public.rrhh_contar_dias(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Pedir, autorizar, cancelar
-- ---------------------------------------------------------------------------
-- p = { tipo, permiso_tipo, desde, hasta, hora, motivo, evidencia_path, evidencia_nombre }
create or replace function public.rrhh_solicitar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tipo text := p ->> 'tipo';
  v_ptipo text := nullif(p ->> 'permiso_tipo', '');
  v_desde date := nullif(p ->> 'desde', '')::date;
  v_hasta date;
  v_hoy date := public.local_today();
  v_dias int := 0;
  v_ev text := nullif(left(p ->> 'evidencia_path', 300), '');
  c public.rrhh_config;
  e public.rrhh_empleados;
  s record;
  v_id uuid;
  v_nom text;
  v_txt text;
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v_tipo not in ('vacaciones', 'permiso') then raise exception 'Elige vacaciones o permiso'; end if;
  if v_desde is null then raise exception 'Pon la fecha'; end if;
  v_hasta := coalesce(nullif(p ->> 'hasta', '')::date, v_desde);
  if v_hasta < v_desde then raise exception 'La fecha final es antes de la inicial'; end if;
  if v_hasta - v_desde > 60 then raise exception 'El rango no puede pasar de 60 días'; end if;
  if v_ev is not null and v_ev not like auth.uid()::text || '/%' then raise exception 'Evidencia inválida'; end if;
  select * into c from public.rrhh_config where id = 1;
  select * into e from public.rrhh_empleados where profile_id = auth.uid();
  if v_tipo = 'vacaciones' then
    v_ptipo := null;
    if e.profile_id is null then
      raise exception 'La gerente todavía no captura tu fecha de ingreso y tus días. Pídele que lo haga para poder pedir vacaciones.';
    end if;
    if v_desde < v_hoy then raise exception 'Las vacaciones no pueden empezar en una fecha pasada'; end if;
    if v_desde < v_hoy + c.anticipacion_dias then
      raise exception 'Las vacaciones se piden con al menos % días de anticipación', c.anticipacion_dias;
    end if;
    v_dias := public.rrhh_dias_rango(v_desde, v_hasta);
    if v_dias = 0 then
      raise exception 'En esas fechas no hay días laborables que descontar (son festivos, domingos o vacaciones generales)';
    end if;
    select * into s from public.rrhh_saldo_calc(auth.uid());
    if v_dias > s.disponible + c.adelanto_max then
      raise exception 'Pides % días y tienes % disponibles', v_dias, trim(to_char(s.disponible, 'FM999990.9'));
    end if;
    if exists (select 1 from public.rrhh_solicitudes x where x.empleado_id = auth.uid() and x.tipo = 'vacaciones'
                and x.estado in ('pendiente', 'visto_jefe', 'aprobada') and x.desde <= v_hasta and x.hasta >= v_desde) then
      raise exception 'Ya tienes vacaciones pedidas en esas fechas';
    end if;
  else
    if v_ptipo not in ('llegar_tarde', 'salir_temprano', 'ausentarse') then raise exception 'Elige el tipo de permiso'; end if;
    if v_desde < v_hoy - 30 then raise exception 'El permiso no puede ser de hace más de 30 días'; end if;
    if length(trim(coalesce(p ->> 'motivo', ''))) < 3 then raise exception 'Escribe el motivo del permiso'; end if;
  end if;

  insert into public.rrhh_solicitudes (empleado_id, tipo, permiso_tipo, desde, hasta, hora, motivo, dias, evidencia_path, evidencia_nombre, jefe_id)
  values (auth.uid(), v_tipo, v_ptipo, v_desde, v_hasta, nullif(left(trim(coalesce(p ->> 'hora', '')), 40), ''),
          nullif(left(trim(coalesce(p ->> 'motivo', '')), 1000), ''), v_dias, v_ev, nullif(left(p ->> 'evidencia_nombre', 200), ''), e.jefe_id)
  returning id into v_id;

  select nombre into v_nom from public.profiles where id = auth.uid();
  v_txt := case v_tipo when 'vacaciones' then format('Vacaciones: %s días (%s al %s)', v_dias, to_char(v_desde, 'DD/MM'), to_char(v_hasta, 'DD/MM'))
    else format('Permiso para el %s', to_char(v_desde, 'DD/MM')) end;
  if e.jefe_id is not null then
    perform public.notify_user(e.jefe_id, 'rrhh', 'Solicitud de ' || v_nom, v_txt, '/rrhh', v_id);
  else
    perform public.notify_role('gerente', 'rrhh', 'Solicitud de ' || v_nom, v_txt, '/rrhh/gerencia', v_id);
  end if;
  return v_id;
end;
$$;
revoke all on function public.rrhh_solicitar(jsonb) from public, anon;
grant execute on function public.rrhh_solicitar(jsonb) to authenticated;

-- accion: 'visto' (jefe inmediato), 'aprobar' (gerente), 'rechazar' (jefe o gerente)
create or replace function public.rrhh_resolver(p_id uuid, p_accion text, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.rrhh_solicitudes;
  v_ger boolean := public.is_gerente();
  v_jefe boolean;
  v_com text := nullif(left(trim(coalesce(p_comentario, '')), 500), '');
  v_nom text;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if s.id is null then raise exception 'No encontré la solicitud'; end if;
  v_jefe := s.jefe_id = auth.uid();
  if not (v_ger or v_jefe) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if s.empleado_id = auth.uid() then raise exception 'No puedes autorizar tu propia solicitud'; end if;
  if s.estado not in ('pendiente', 'visto_jefe') then raise exception 'Esta solicitud ya se resolvió'; end if;
  select nombre into v_nom from public.profiles where id = s.empleado_id;
  if p_accion = 'visto' then
    if not v_jefe then raise exception 'El visto bueno lo da el jefe inmediato'; end if;
    if s.estado <> 'pendiente' then raise exception 'Ya tiene visto bueno'; end if;
    update public.rrhh_solicitudes set estado = 'visto_jefe', jefe_por = auth.uid(), jefe_at = now(), comentario = coalesce(v_com, comentario) where id = p_id;
    perform public.notify_role('gerente', 'rrhh', 'Por autorizar: ' || v_nom, 'Ya tiene el visto bueno de su jefe', '/rrhh/gerencia', p_id);
  elsif p_accion = 'aprobar' then
    if not v_ger then raise exception 'La autorización la da la gerente'; end if;
    update public.rrhh_solicitudes set estado = 'aprobada', resuelto_por = auth.uid(), resuelto_at = now(), comentario = coalesce(v_com, comentario) where id = p_id;
    perform public.notify_user(s.empleado_id, 'rrhh', case s.tipo when 'vacaciones' then 'Vacaciones autorizadas' else 'Permiso autorizado' end,
      format('Del %s al %s', to_char(s.desde, 'DD/MM'), to_char(s.hasta, 'DD/MM')), '/rrhh', p_id);
  elsif p_accion = 'rechazar' then
    update public.rrhh_solicitudes set estado = 'rechazada', resuelto_por = auth.uid(), resuelto_at = now(), comentario = coalesce(v_com, comentario) where id = p_id;
    perform public.notify_user(s.empleado_id, 'rrhh', case s.tipo when 'vacaciones' then 'Vacaciones no autorizadas' else 'Permiso no autorizado' end,
      coalesce(v_com, 'Habla con tu jefe o con la gerente'), '/rrhh', p_id);
  else
    raise exception 'Acción inválida';
  end if;
end;
$$;
revoke all on function public.rrhh_resolver(uuid, text, text) from public, anon;
grant execute on function public.rrhh_resolver(uuid, text, text) to authenticated;

-- El colaborador cancela la suya (en espera, o autorizada que aun no empieza); la gerente cualquiera.
create or replace function public.rrhh_cancelar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.rrhh_solicitudes;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if s.id is null then raise exception 'No encontré la solicitud'; end if;
  if not (s.empleado_id = auth.uid() or public.is_gerente()) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if not (s.estado in ('pendiente', 'visto_jefe') or (s.estado = 'aprobada' and (s.desde > public.local_today() or public.is_gerente()))) then
    raise exception 'Esta solicitud ya no se puede cancelar';
  end if;
  update public.rrhh_solicitudes set estado = 'cancelada', resuelto_por = auth.uid(), resuelto_at = now() where id = p_id;
end;
$$;
revoke all on function public.rrhh_cancelar(uuid) from public, anon;
grant execute on function public.rrhh_cancelar(uuid) to authenticated;

-- Lista de solicitudes con nombres (cada quien las suyas; el jefe las de su equipo; la gerente todas).
create or replace function public.rrhh_solicitudes_ver()
returns table (id uuid, folio bigint, empleado_id uuid, nombre text, puesto text, rol text, tipo text, permiso_tipo text,
  desde date, hasta date, hora text, motivo text, dias numeric, estado text, evidencia_nombre text, tiene_evidencia boolean,
  jefe_nombre text, jefe_at timestamptz, resuelto_nombre text, resuelto_at timestamptz, comentario text, created_at timestamptz,
  mia boolean, soy_jefe boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_ger boolean := public.is_gerente();
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select s.id, s.folio, s.empleado_id, p.nombre, e.puesto, p.rol::text, s.tipo, s.permiso_tipo, s.desde, s.hasta, s.hora, s.motivo,
      s.dias, s.estado, s.evidencia_nombre, s.evidencia_path is not null,
      (select j.nombre from public.profiles j where j.id = coalesce(s.jefe_por, s.jefe_id)), s.jefe_at,
      (select r.nombre from public.profiles r where r.id = s.resuelto_por), s.resuelto_at, s.comentario, s.created_at,
      s.empleado_id = auth.uid(), coalesce(s.jefe_id = auth.uid(), false)
    from public.rrhh_solicitudes s
    join public.profiles p on p.id = s.empleado_id
    left join public.rrhh_empleados e on e.profile_id = s.empleado_id
    where (v_ger or s.empleado_id = auth.uid() or s.jefe_id = auth.uid())
      and (s.desde >= public.local_today() - 400 or s.estado in ('pendiente', 'visto_jefe'))
    order by s.desde desc, s.created_at desc;
end;
$$;
revoke all on function public.rrhh_solicitudes_ver() from public, anon;
grant execute on function public.rrhh_solicitudes_ver() to authenticated;

-- Calendario: festivos, temporadas y dias ocupados. Los demas solo ven el puesto; la gerente, el nombre.
create or replace function public.rrhh_calendario(p_desde date, p_hasta date)
returns table (clase text, desde date, hasta date, titulo text, puesto text, nombre text, mio boolean, estado text, descuento date[])
language plpgsql stable security definer set search_path = public as $$
declare v_ger boolean := public.is_gerente();
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_hasta - p_desde > 120 then raise exception 'Rango muy grande'; end if;
  return query
    select 'festivo'::text, f.fecha, f.fecha, f.nombre, null::text, null::text, false, null::text, null::date[]
      from public.rrhh_festivos f where f.fecha between p_desde and p_hasta
    union all
    select 'temporada', t.desde, t.hasta, t.nombre, null, null, false, null, t.dias_descuento
      from public.rrhh_temporadas t where t.desde <= p_hasta and t.hasta >= p_desde
    union all
    select s.tipo, s.desde, s.hasta,
      case s.tipo when 'vacaciones' then 'Vacaciones' else case s.permiso_tipo when 'llegar_tarde' then 'Llega tarde' when 'salir_temprano' then 'Sale temprano' else 'Permiso' end end,
      coalesce(e.puesto, p.rol::text),
      case when v_ger or s.empleado_id = auth.uid() or s.jefe_id = auth.uid() then p.nombre end,
      s.empleado_id = auth.uid(), s.estado, null
      from public.rrhh_solicitudes s
      join public.profiles p on p.id = s.empleado_id
      left join public.rrhh_empleados e on e.profile_id = s.empleado_id
     where s.estado in ('pendiente', 'visto_jefe', 'aprobada') and s.desde <= p_hasta and s.hasta >= p_desde;
end;
$$;
revoke all on function public.rrhh_calendario(date, date) from public, anon;
grant execute on function public.rrhh_calendario(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Evidencia (PDF o foto), privada: el colaborador, su jefe y la gerente.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rrhh', 'rrhh', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists rrhh_storage_insert on storage.objects;
create policy rrhh_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'rrhh' and public.is_active_user() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists rrhh_storage_select on storage.objects;
create policy rrhh_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'rrhh' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_gerente()
    or exists (select 1 from public.rrhh_empleados e where e.profile_id::text = (storage.foldername(name))[1] and e.jefe_id = auth.uid())));

commit;
