-- =============================================================================
-- 0093_rrhh_filtros_consumo.sql   (requiere 0092)
-- 1) VACACIONES Y PERMISOS: QUIEN AUTORIZA SEGUN EL PUESTO (dos filtros)
--    * Vendedores: primero la jefa de ventas y luego la gerente.
--    * Auxiliar de finanzas: primero la supervisora de finanzas y luego la gerente.
--    * Almacen (con o sin portal): primero el supervisor de almacen y luego la gerente.
--    * Comprador, supervisores, jefa de ventas y los demas: directo con la gerente.
--    * La gerente termina de autorizar y puede cambiarla: un permiso como vacaciones (descuenta dias)
--      o unas vacaciones como permiso.
--    * Colaboradores SIN portal (los de almacen): el supervisor de almacen los da de alta con su
--      nombre y pide por ellos. La gerente les captura fecha de ingreso y dias como a todos.
--    * La gerente ve a TODOS los del sistema (y los sin portal).
-- 2) CONSUMO INTERNO: la jefa de ventas aprueba solo lo que piden los vendedores. Lo que piden
--    almacen, finanzas, la jefa de ventas y los demas lo aprueba la gerente.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Colaboradores: ahora pueden no tener usuario del portal
-- ---------------------------------------------------------------------------
alter table public.rrhh_empleados add column if not exists id uuid not null default gen_random_uuid();
alter table public.rrhh_empleados add column if not exists nombre text check (length(nombre) <= 120);
alter table public.rrhh_empleados add column if not exists jefe_rol text check (jefe_rol in ('jefe_ventas', 'supervisor_almacen', 'supervisor_finanzas'));
alter table public.rrhh_empleados add column if not exists activo boolean not null default true;
alter table public.rrhh_empleados add column if not exists created_by uuid references public.profiles (id) default auth.uid();
-- El jefe ya no se elige a mano: sale del puesto.
alter table public.rrhh_empleados drop constraint if exists rrhh_empleados_check;
alter table public.rrhh_empleados drop constraint if exists rrhh_empleados_pkey;
alter table public.rrhh_empleados add primary key (id);
alter table public.rrhh_empleados alter column profile_id drop not null;
alter table public.rrhh_empleados alter column fecha_ingreso drop not null;
alter table public.rrhh_empleados drop constraint if exists rrhh_empleados_profile_key;
alter table public.rrhh_empleados add constraint rrhh_empleados_profile_key unique (profile_id);
alter table public.rrhh_empleados drop constraint if exists rrhh_empleados_quien;
alter table public.rrhh_empleados add constraint rrhh_empleados_quien check (profile_id is not null or length(trim(coalesce(nombre, ''))) > 1);

-- Cada usuario del portal tiene su renglon (sin fecha = falta que la gerente lo capture).
insert into public.rrhh_empleados (profile_id, saldo_inicial) select p.id, 0 from public.profiles p
 where not exists (select 1 from public.rrhh_empleados e where e.profile_id = p.id);
create or replace function public.rrhh_profile_nuevo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.rrhh_empleados (profile_id, saldo_inicial) values (new.id, 0) on conflict (profile_id) do nothing;
  return null;
end;
$$;
drop trigger if exists rrhh_profile_nuevo on public.profiles;
create trigger rrhh_profile_nuevo after insert on public.profiles for each row execute function public.rrhh_profile_nuevo();

-- Al capturar por primera vez la fecha de ingreso tambien arranca el saldo.
create or replace function public.rrhh_empleado_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.saldo_inicial is distinct from old.saldo_inicial or new.saldo_al is distinct from old.saldo_al
     or (old.fecha_ingreso is null and new.fecha_ingreso is not null) then
    new.saldo_set_at := now();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- Quien da el primer visto bueno segun el puesto (null = directo con la gerente).
create or replace function public.rrhh_jefe_rol(p_colab uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when e.profile_id is null then coalesce(e.jefe_rol, 'supervisor_almacen')
    else case p.rol::text when 'vendedor' then 'jefe_ventas' when 'aux_finanzas' then 'supervisor_finanzas' when 'almacen' then 'supervisor_almacen' end end
  from public.rrhh_empleados e left join public.profiles p on p.id = e.profile_id where e.id = p_colab;
$$;
create or replace function public.rrhh_soy(p_rol text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_rol is not null and public.has_role(p_rol::public.user_role);
$$;

-- ---------------------------------------------------------------------------
-- Solicitudes: ligadas al colaborador
-- ---------------------------------------------------------------------------
alter table public.rrhh_solicitudes add column if not exists colaborador_id uuid references public.rrhh_empleados (id);
alter table public.rrhh_solicitudes add column if not exists jefe_rol text;
alter table public.rrhh_solicitudes add column if not exists registro_por uuid references public.profiles (id);
alter table public.rrhh_solicitudes add column if not exists cambio text check (length(cambio) <= 200);
alter table public.rrhh_solicitudes alter column empleado_id drop not null;
update public.rrhh_solicitudes s set colaborador_id = e.id from public.rrhh_empleados e where e.profile_id = s.empleado_id and s.colaborador_id is null;
update public.rrhh_solicitudes s set jefe_rol = public.rrhh_jefe_rol(s.colaborador_id), jefe_id = null where s.jefe_rol is null;
alter table public.rrhh_solicitudes alter column colaborador_id set not null;
create index if not exists rrhh_solicitudes_colab_idx on public.rrhh_solicitudes (colaborador_id, desde);

drop policy if exists rrhh_empleados_select on public.rrhh_empleados;
create policy rrhh_empleados_select on public.rrhh_empleados for select to authenticated
  using (profile_id = auth.uid() or public.is_gerente() or public.rrhh_soy(public.rrhh_jefe_rol(id)));
drop policy if exists rrhh_solicitudes_select on public.rrhh_solicitudes;
create policy rrhh_solicitudes_select on public.rrhh_solicitudes for select to authenticated
  using (empleado_id = auth.uid() or public.is_gerente() or public.rrhh_soy(jefe_rol));
drop policy if exists rrhh_storage_select on storage.objects;
create policy rrhh_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'rrhh' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_gerente()
    or exists (select 1 from public.rrhh_solicitudes s where s.evidencia_path = name and public.rrhh_soy(s.jefe_rol))));

-- ---------------------------------------------------------------------------
-- Saldos
-- ---------------------------------------------------------------------------
drop function if exists public.rrhh_saldos();
drop function if exists public.rrhh_saldo_calc(uuid);
create or replace function public.rrhh_saldo_calc(p_colab uuid)
returns table (colaborador_id uuid, empleado_id uuid, nombre text, rol text, sin_portal boolean, jefe_rol text, capturado boolean,
  fecha_ingreso date, puesto text, departamento text, anios int, dias_ley int, proximo_aniversario date, dias_proximo int,
  saldo_inicial numeric, saldo_al date, ganados numeric, usados numeric, temporada numeric, pendientes numeric, disponible numeric,
  permisos_anio int)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.rrhh_empleados;
  v_nom text; v_rol text;
  v_hoy date := public.local_today();
  v_anios int;
  v_gan numeric := 0; v_us numeric := 0; v_tmp numeric := 0; v_pen numeric := 0; v_perm int := 0;
begin
  select * into e from public.rrhh_empleados where id = p_colab;
  if e.id is null then return; end if;
  select p.nombre, p.rol::text into v_nom, v_rol from public.profiles p where p.id = e.profile_id;
  v_nom := coalesce(v_nom, e.nombre);
  select count(*)::int into v_perm from public.rrhh_solicitudes s
   where s.colaborador_id = p_colab and s.tipo = 'permiso' and s.estado = 'aprobada' and extract(year from s.desde) = extract(year from v_hoy);
  if e.fecha_ingreso is null then
    return query select e.id, e.profile_id, v_nom, v_rol, e.profile_id is null, public.rrhh_jefe_rol(e.id), false, null::date, e.puesto, e.departamento,
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
   where s.colaborador_id = p_colab and s.tipo = 'vacaciones' and s.created_at > e.saldo_set_at;
  select count(distinct d) into v_tmp
    from public.rrhh_temporadas t, unnest(t.dias_descuento) d
   where d > e.saldo_al and d >= e.fecha_ingreso and public.rrhh_es_laborable(d);
  return query select e.id, e.profile_id, v_nom, v_rol, e.profile_id is null, public.rrhh_jefe_rol(e.id), true, e.fecha_ingreso, e.puesto, e.departamento,
    v_anios, public.rrhh_dias_ley(v_anios), (e.fecha_ingreso + make_interval(years => v_anios + 1))::date, public.rrhh_dias_ley(v_anios + 1),
    e.saldo_inicial, e.saldo_al, v_gan, v_us, v_tmp, v_pen, e.saldo_inicial + v_gan - v_us - v_tmp - v_pen, v_perm;
end;
$$;
revoke all on function public.rrhh_saldo_calc(uuid) from public, anon, authenticated;

-- La gerente (y CEO) ve a todos; cada jefe a los que le toca autorizar; cada quien a si mismo.
create or replace function public.rrhh_saldos()
returns table (colaborador_id uuid, empleado_id uuid, nombre text, rol text, sin_portal boolean, jefe_rol text, capturado boolean,
  fecha_ingreso date, puesto text, departamento text, anios int, dias_ley int, proximo_aniversario date, dias_proximo int,
  saldo_inicial numeric, saldo_al date, ganados numeric, usados numeric, temporada numeric, pendientes numeric, disponible numeric,
  permisos_anio int)
language plpgsql stable security definer set search_path = public as $$
declare v_ger boolean := public.is_gerente();
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select c.* from public.rrhh_empleados e
    left join public.profiles p on p.id = e.profile_id
    cross join lateral public.rrhh_saldo_calc(e.id) c
    where (case when e.profile_id is null then e.activo else p.activo end)
      and (v_ger or e.profile_id = auth.uid() or public.rrhh_soy(public.rrhh_jefe_rol(e.id)))
    order by (e.profile_id is distinct from auth.uid()), c.nombre;
end;
$$;
revoke all on function public.rrhh_saldos() from public, anon;
grant execute on function public.rrhh_saldos() to authenticated;

-- La gerente captura fecha de ingreso, puesto y dias. p = { id | profile_id, fecha_ingreso, puesto, departamento, saldo_inicial, saldo_al, notas }
create or replace function public.rrhh_empleado_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_prof uuid := nullif(p ->> 'profile_id', '')::uuid;
begin
  if not public.is_gerente() then raise exception 'Solo la gerente captura los días' using errcode = '42501'; end if;
  if v_id is null and v_prof is not null then
    insert into public.rrhh_empleados (profile_id, saldo_inicial) values (v_prof, 0) on conflict (profile_id) do nothing;
    select id into v_id from public.rrhh_empleados where profile_id = v_prof;
  end if;
  if v_id is null then raise exception 'Colaborador inválido'; end if;
  update public.rrhh_empleados set
    fecha_ingreso = nullif(p ->> 'fecha_ingreso', '')::date,
    puesto = nullif(left(trim(coalesce(p ->> 'puesto', '')), 80), ''),
    departamento = nullif(left(trim(coalesce(p ->> 'departamento', '')), 80), ''),
    saldo_inicial = coalesce((p ->> 'saldo_inicial')::numeric, 0),
    saldo_al = coalesce(nullif(p ->> 'saldo_al', '')::date, public.local_today()),
    notas = nullif(left(trim(coalesce(p ->> 'notas', '')), 500), ''),
    nombre = case when profile_id is null then coalesce(nullif(left(trim(coalesce(p ->> 'nombre', '')), 120), ''), nombre) else nombre end
  where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.rrhh_empleado_guardar(jsonb) from public, anon;
grant execute on function public.rrhh_empleado_guardar(jsonb) to authenticated;

-- Colaborador sin portal: lo da de alta el supervisor de almacen (o la gerente). p = { id, nombre, puesto, activo, jefe_rol }
create or replace function public.rrhh_externo_guardar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_ger boolean := public.is_gerente();
  v_jr text := case when public.is_gerente() then coalesce(nullif(p ->> 'jefe_rol', ''), 'supervisor_almacen') else 'supervisor_almacen' end;
  v_nom text := left(trim(coalesce(p ->> 'nombre', '')), 120);
  e public.rrhh_empleados;
begin
  if not (v_ger or public.has_role('supervisor_almacen')) then raise exception 'Solo el supervisor de almacén o la gerente' using errcode = '42501'; end if;
  if length(v_nom) < 2 then raise exception 'Escribe el nombre del colaborador'; end if;
  if v_jr not in ('jefe_ventas', 'supervisor_almacen', 'supervisor_finanzas') then v_jr := 'supervisor_almacen'; end if;
  if v_id is null then
    insert into public.rrhh_empleados (profile_id, nombre, puesto, jefe_rol, saldo_inicial)
    values (null, v_nom, nullif(left(trim(coalesce(p ->> 'puesto', '')), 80), ''), v_jr, 0) returning id into v_id;
  else
    select * into e from public.rrhh_empleados where id = v_id for update;
    if e.id is null or e.profile_id is not null then raise exception 'Colaborador inválido'; end if;
    if not v_ger and e.jefe_rol is distinct from 'supervisor_almacen' then raise exception 'Sin permiso' using errcode = '42501'; end if;
    update public.rrhh_empleados set nombre = v_nom, puesto = nullif(left(trim(coalesce(p ->> 'puesto', '')), 80), ''),
      activo = coalesce((p ->> 'activo')::boolean, activo), jefe_rol = case when v_ger then v_jr else jefe_rol end
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.rrhh_externo_guardar(jsonb) from public, anon;
grant execute on function public.rrhh_externo_guardar(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Pedir (para mi, o el jefe/gerente por un colaborador sin portal)
-- p = { colaborador_id?, tipo, permiso_tipo, desde, hasta, hora, motivo, evidencia_path, evidencia_nombre }
-- ---------------------------------------------------------------------------
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
  v_colab uuid := nullif(p ->> 'colaborador_id', '')::uuid;
  v_por_otro boolean := false;
  v_jr text;
  v_estado text := 'pendiente';
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

  if v_colab is null then
    insert into public.rrhh_empleados (profile_id, saldo_inicial) values (auth.uid(), 0) on conflict (profile_id) do nothing;
    select * into e from public.rrhh_empleados where profile_id = auth.uid();
  else
    select * into e from public.rrhh_empleados where id = v_colab;
    if e.id is null then raise exception 'Colaborador inválido'; end if;
    if e.profile_id is distinct from auth.uid() then
      -- Solo por colaboradores sin portal: su jefe o la gerente.
      if e.profile_id is not null or not e.activo or not (public.is_gerente() or public.rrhh_soy(public.rrhh_jefe_rol(e.id))) then
        raise exception 'Solo puedes pedir por los colaboradores sin portal de tu equipo' using errcode = '42501';
      end if;
      v_por_otro := true;
    end if;
  end if;
  v_jr := public.rrhh_jefe_rol(e.id);
  v_nom := coalesce((select nombre from public.profiles where id = e.profile_id), e.nombre);

  if v_tipo = 'vacaciones' then
    v_ptipo := null;
    if e.fecha_ingreso is null then
      raise exception '%', case when v_por_otro then 'La gerente todavía no captura la fecha de ingreso y los días de ' || v_nom
        else 'La gerente todavía no captura tu fecha de ingreso y tus días. Pídele que lo haga para poder pedir vacaciones.' end;
    end if;
    if v_por_otro then
      if v_desde < v_hoy - 30 then raise exception 'No puede ser de hace más de 30 días'; end if;
    else
      if v_desde < v_hoy then raise exception 'Las vacaciones no pueden empezar en una fecha pasada'; end if;
      if v_desde < v_hoy + c.anticipacion_dias then
        raise exception 'Las vacaciones se piden con al menos % días de anticipación', c.anticipacion_dias;
      end if;
    end if;
    v_dias := public.rrhh_dias_rango(v_desde, v_hasta);
    if v_dias = 0 then
      raise exception 'En esas fechas no hay días laborables que descontar (son festivos, domingos o vacaciones generales)';
    end if;
    select * into s from public.rrhh_saldo_calc(e.id);
    if v_dias > s.disponible + c.adelanto_max then
      raise exception 'Pide % días y tiene % disponibles', v_dias, trim(to_char(s.disponible, 'FM999990.9'));
    end if;
    if exists (select 1 from public.rrhh_solicitudes x where x.colaborador_id = e.id and x.tipo = 'vacaciones'
                and x.estado in ('pendiente', 'visto_jefe', 'aprobada') and x.desde <= v_hasta and x.hasta >= v_desde) then
      raise exception 'Ya hay vacaciones pedidas en esas fechas';
    end if;
  else
    if v_ptipo not in ('llegar_tarde', 'salir_temprano', 'ausentarse') then raise exception 'Elige el tipo de permiso'; end if;
    if v_desde < v_hoy - 30 then raise exception 'El permiso no puede ser de hace más de 30 días'; end if;
    if length(trim(coalesce(p ->> 'motivo', ''))) < 3 then raise exception 'Escribe el motivo del permiso'; end if;
  end if;

  -- Si lo registra su jefe, ya trae el visto bueno; si lo registra la gerente, queda autorizado.
  if v_por_otro and public.is_gerente() then v_estado := 'aprobada';
  elsif v_por_otro then v_estado := 'visto_jefe';
  end if;

  insert into public.rrhh_solicitudes (colaborador_id, empleado_id, tipo, permiso_tipo, desde, hasta, hora, motivo, dias, evidencia_path, evidencia_nombre,
    jefe_rol, registro_por, estado, jefe_por, jefe_at, resuelto_por, resuelto_at)
  values (e.id, e.profile_id, v_tipo, v_ptipo, v_desde, v_hasta, nullif(left(trim(coalesce(p ->> 'hora', '')), 40), ''),
          nullif(left(trim(coalesce(p ->> 'motivo', '')), 1000), ''), v_dias, v_ev, nullif(left(p ->> 'evidencia_nombre', 200), ''),
          v_jr, auth.uid(), v_estado,
          case when v_estado = 'visto_jefe' then auth.uid() end, case when v_estado = 'visto_jefe' then now() end,
          case when v_estado = 'aprobada' then auth.uid() end, case when v_estado = 'aprobada' then now() end)
  returning id into v_id;

  v_txt := case v_tipo when 'vacaciones' then format('Vacaciones: %s días (%s al %s)', v_dias, to_char(v_desde, 'DD/MM'), to_char(v_hasta, 'DD/MM'))
    else format('Permiso para el %s', to_char(v_desde, 'DD/MM')) end;
  if v_estado = 'pendiente' and v_jr is not null then
    perform public.notify_role(v_jr::public.user_role, 'rrhh', 'Solicitud de ' || v_nom, v_txt, '/rrhh', v_id);
  elsif v_estado <> 'aprobada' then
    perform public.notify_role('gerente', 'rrhh', 'Por autorizar: ' || v_nom, v_txt, '/rrhh/gerencia', v_id);
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Autorizar. La gerente puede cambiar el tipo (permiso <-> vacaciones) y los dias.
-- ---------------------------------------------------------------------------
drop function if exists public.rrhh_resolver(uuid, text, text);
create or replace function public.rrhh_resolver(p_id uuid, p_accion text, p_comentario text default null,
  p_tipo text default null, p_permiso_tipo text default null, p_dias numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.rrhh_solicitudes;
  v_ger boolean := public.is_gerente();
  v_jefe boolean;
  v_com text := nullif(left(trim(coalesce(p_comentario, '')), 500), '');
  v_nom text;
  v_tipo text; v_ptipo text; v_dias numeric; v_cambio text;
  v_lbl text;
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if s.id is null then raise exception 'No encontré la solicitud'; end if;
  v_jefe := public.rrhh_soy(s.jefe_rol);
  if not (v_ger or v_jefe) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if s.empleado_id = auth.uid() then raise exception 'No puedes autorizar tu propia solicitud'; end if;
  if s.estado not in ('pendiente', 'visto_jefe') then raise exception 'Esta solicitud ya se resolvió'; end if;
  select coalesce(p.nombre, e.nombre) into v_nom from public.rrhh_empleados e left join public.profiles p on p.id = e.profile_id where e.id = s.colaborador_id;
  if p_accion = 'visto' then
    if not v_jefe then raise exception 'El visto bueno lo da el jefe inmediato'; end if;
    if s.estado <> 'pendiente' then raise exception 'Ya tiene visto bueno'; end if;
    update public.rrhh_solicitudes set estado = 'visto_jefe', jefe_por = auth.uid(), jefe_at = now(), comentario = coalesce(v_com, comentario) where id = p_id;
    perform public.notify_role('gerente', 'rrhh', 'Por autorizar: ' || v_nom, 'Ya tiene el visto bueno de su jefe', '/rrhh/gerencia', p_id);
  elsif p_accion = 'aprobar' then
    if not v_ger then raise exception 'La autorización final la da la gerente'; end if;
    v_tipo := coalesce(nullif(p_tipo, ''), s.tipo);
    if v_tipo not in ('vacaciones', 'permiso') then raise exception 'Tipo inválido'; end if;
    if v_tipo = 'vacaciones' then
      v_ptipo := null;
      v_dias := coalesce(p_dias, case when s.tipo = 'vacaciones' then s.dias else public.rrhh_dias_rango(s.desde, s.hasta) end);
      if v_dias < 0 or v_dias > 60 then raise exception 'Días inválidos'; end if;
      v_dias := round(v_dias * 2) / 2;
    else
      v_ptipo := coalesce(nullif(p_permiso_tipo, ''), s.permiso_tipo, 'ausentarse');
      if v_ptipo not in ('llegar_tarde', 'salir_temprano', 'ausentarse') then raise exception 'Tipo de permiso inválido'; end if;
      v_dias := 0;
    end if;
    v_lbl := case when s.tipo = 'vacaciones' then 'vacaciones' else 'permiso' end;
    if v_tipo <> s.tipo then
      v_cambio := format('La gerente lo cambió de %s a %s', v_lbl, v_tipo) || case when v_tipo = 'vacaciones' then format(' (%s días)', trim(to_char(v_dias, 'FM9990.9'))) else '' end;
    elsif v_tipo = 'vacaciones' and v_dias <> s.dias then
      v_cambio := format('La gerente ajustó los días de %s a %s', trim(to_char(s.dias, 'FM9990.9')), trim(to_char(v_dias, 'FM9990.9')));
    end if;
    update public.rrhh_solicitudes set estado = 'aprobada', tipo = v_tipo, permiso_tipo = v_ptipo, dias = v_dias, cambio = coalesce(v_cambio, cambio),
      resuelto_por = auth.uid(), resuelto_at = now(), comentario = coalesce(v_com, comentario) where id = p_id;
    if s.empleado_id is not null then
      perform public.notify_user(s.empleado_id, 'rrhh', case v_tipo when 'vacaciones' then 'Vacaciones autorizadas' else 'Permiso autorizado' end,
        coalesce(v_cambio || '. ', '') || format('Del %s al %s', to_char(s.desde, 'DD/MM'), to_char(s.hasta, 'DD/MM')), '/rrhh', p_id);
    end if;
  elsif p_accion = 'rechazar' then
    update public.rrhh_solicitudes set estado = 'rechazada', resuelto_por = auth.uid(), resuelto_at = now(), comentario = coalesce(v_com, comentario) where id = p_id;
    if s.empleado_id is not null then
      perform public.notify_user(s.empleado_id, 'rrhh', case s.tipo when 'vacaciones' then 'Vacaciones no autorizadas' else 'Permiso no autorizado' end,
        coalesce(v_com, 'Habla con tu jefe o con la gerente'), '/rrhh', p_id);
    end if;
  else
    raise exception 'Acción inválida';
  end if;
end;
$$;
revoke all on function public.rrhh_resolver(uuid, text, text, text, text, numeric) from public, anon;
grant execute on function public.rrhh_resolver(uuid, text, text, text, text, numeric) to authenticated;

create or replace function public.rrhh_cancelar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.rrhh_solicitudes; v_ger boolean := public.is_gerente();
begin
  select * into s from public.rrhh_solicitudes where id = p_id for update;
  if s.id is null then raise exception 'No encontré la solicitud'; end if;
  if not (s.empleado_id = auth.uid() or v_ger or (s.empleado_id is null and public.rrhh_soy(s.jefe_rol))) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not (s.estado in ('pendiente', 'visto_jefe') or (s.estado = 'aprobada' and (s.desde > public.local_today() or v_ger))) then
    raise exception 'Esta solicitud ya no se puede cancelar';
  end if;
  update public.rrhh_solicitudes set estado = 'cancelada', resuelto_por = auth.uid(), resuelto_at = now() where id = p_id;
end;
$$;

drop function if exists public.rrhh_solicitudes_ver();
create or replace function public.rrhh_solicitudes_ver()
returns table (id uuid, folio bigint, colaborador_id uuid, empleado_id uuid, nombre text, puesto text, rol text, sin_portal boolean, jefe_rol text,
  tipo text, permiso_tipo text, desde date, hasta date, hora text, motivo text, dias numeric, estado text, evidencia_nombre text, tiene_evidencia boolean,
  jefe_nombre text, jefe_at timestamptz, resuelto_nombre text, resuelto_at timestamptz, registro_nombre text, comentario text, cambio text,
  created_at timestamptz, mia boolean, soy_jefe boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_ger boolean := public.is_gerente();
begin
  if not public.is_active_user() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  return query
    select s.id, s.folio, s.colaborador_id, s.empleado_id, coalesce(p.nombre, e.nombre), e.puesto, p.rol::text, e.profile_id is null, s.jefe_rol,
      s.tipo, s.permiso_tipo, s.desde, s.hasta, s.hora, s.motivo,
      s.dias, s.estado, s.evidencia_nombre, s.evidencia_path is not null,
      (select j.nombre from public.profiles j where j.id = s.jefe_por), s.jefe_at,
      (select r.nombre from public.profiles r where r.id = s.resuelto_por), s.resuelto_at,
      case when s.registro_por is distinct from s.empleado_id then (select r.nombre from public.profiles r where r.id = s.registro_por) end,
      s.comentario, s.cambio, s.created_at,
      coalesce(s.empleado_id = auth.uid(), false), public.rrhh_soy(s.jefe_rol)
    from public.rrhh_solicitudes s
    join public.rrhh_empleados e on e.id = s.colaborador_id
    left join public.profiles p on p.id = e.profile_id
    where (v_ger or s.empleado_id = auth.uid() or public.rrhh_soy(s.jefe_rol))
      and (s.desde >= public.local_today() - 400 or s.estado in ('pendiente', 'visto_jefe'))
    order by s.desde desc, s.created_at desc;
end;
$$;
revoke all on function public.rrhh_solicitudes_ver() from public, anon;
grant execute on function public.rrhh_solicitudes_ver() to authenticated;

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
      coalesce(e.puesto, p.rol::text, 'almacen'),
      case when v_ger or s.empleado_id = auth.uid() or public.rrhh_soy(s.jefe_rol) then coalesce(p.nombre, e.nombre) end,
      coalesce(s.empleado_id = auth.uid(), false), s.estado, null
      from public.rrhh_solicitudes s
      join public.rrhh_empleados e on e.id = s.colaborador_id
      left join public.profiles p on p.id = e.profile_id
     where s.estado in ('pendiente', 'visto_jefe', 'aprobada') and s.desde <= p_hasta and s.hasta >= p_desde;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) CONSUMO INTERNO: quien aprueba segun quien pide
-- ---------------------------------------------------------------------------
alter table public.consumo_solicitudes add column if not exists aprobador_rol text check (aprobador_rol in ('jefe_ventas', 'gerente'));
create or replace function public.consumo_aprobador(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p.rol::text when 'vendedor' then 'jefe_ventas' when 'gerente' then null when 'ceo' then null else 'gerente' end
    from public.profiles p where p.id = p_uid;
$$;
update public.consumo_solicitudes set aprobador_rol = public.consumo_aprobador(solicitante_id) where aprobador_rol is null;

create or replace function public.consumo_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.solicitante_id := auth.uid();
    new.solicitante_nombre := public.my_name();
    new.aprobador_rol := public.consumo_aprobador(auth.uid());
    if public.is_gerente() then
      new.estado := 'aprobada'; new.aprobada_por := auth.uid(); new.aprobada_nombre := new.solicitante_nombre; new.aprobada_at := now();
    else
      new.estado := 'por_aprobar';
    end if;
  elsif new.estado is distinct from old.estado and current_setting('esc.consumo_rpc', true) is distinct from '1' then
    raise exception 'El estatus solo cambia con los botones del portal';
  end if;
  return new;
end $$;

create or replace function public.consumo_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_link text := '/consumo/' || new.id; v_t text := new.numero || ': ' || new.descripcion;
begin
  if TG_OP = 'INSERT' then
    insert into public.consumo_eventos (solicitud_id, tipo, nota) values (new.id, 'alta', null);
    if new.estado = 'por_aprobar' then
      perform public.notify_role(coalesce(new.aprobador_rol, 'gerente')::public.user_role, 'consumo_por_aprobar', 'Por aprobar ' || v_t, new.solicitante_nombre || ': ' || new.motivo, v_link, new.id);
    else
      perform public.notify_role('comprador', 'consumo_aprobado', 'Consumo interno ' || v_t, new.solicitante_nombre || ': ' || new.motivo, v_link, new.id);
    end if;
  end if;
  return null;
end $$;

-- Aprueba la jefa de ventas (lo de vendedores) o la gerente (todo lo demas; tambien puede lo de vendedores).
create or replace function public.consumo_aprobar(p_id uuid, p_aprobar boolean, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.consumo_solicitudes;
begin
  select * into v from public.consumo_solicitudes where id = p_id for update;
  if v.id is null or v.estado <> 'por_aprobar' then raise exception 'Esta solicitud ya no esta por aprobar'; end if;
  if not (public.is_gerente() or (coalesce(v.aprobador_rol, 'jefe_ventas') = 'jefe_ventas' and public.is_sales_manager())) then
    raise exception '%', case when v.aprobador_rol = 'gerente' then 'Esta solicitud la aprueba la gerente' else 'Sin permiso para aprobar' end using errcode = '42501';
  end if;
  if v.solicitante_id = auth.uid() then raise exception 'No puedes aprobar tu propia solicitud'; end if;
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

-- La gerente tambien comenta.
drop policy if exists consumo_eventos_insert on public.consumo_eventos;
create policy consumo_eventos_insert on public.consumo_eventos for insert to authenticated
  with check (tipo = 'comentario' and public.can_read_consumo(solicitud_id)
              and (public.is_buyer() or public.is_sales_manager() or public.is_gerente()
                   or exists (select 1 from public.consumo_solicitudes c where c.id = solicitud_id and c.solicitante_id = auth.uid())));

commit;
