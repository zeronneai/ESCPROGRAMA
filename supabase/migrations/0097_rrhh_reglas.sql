-- =============================================================================
-- 0097_rrhh_reglas.sql   (requiere 0093)
-- REGLAS ADICIONALES DE VACACIONES (las agrega la gerente, ademas de las de siempre)
--  * nota: una regla escrita que ven todos (ej. "Las vacaciones se platican con tu jefe antes de pedirlas").
--  * bloqueo: fechas en las que NO se pueden pedir vacaciones (ej. inventario, cierre de mes).
--  * max_simultaneos: cuantas personas del mismo puesto (o de toda la empresa) pueden estar de vacaciones
--    el mismo dia.
--  * max_dias: maximo de dias por solicitud.
--  * Se pueden apagar sin borrarlas. La gerente al autorizar decide (las reglas frenan al pedir).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create table if not exists public.rrhh_reglas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('nota', 'bloqueo', 'max_simultaneos', 'max_dias')),
  texto text check (length(texto) <= 500),
  desde date,
  hasta date,
  valor int check (valor between 0 and 365),
  puesto text check (length(puesto) <= 80),
  activo boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (tipo <> 'nota' or length(trim(coalesce(texto, ''))) > 2),
  check (tipo <> 'bloqueo' or (desde is not null and hasta is not null and hasta >= desde)),
  check (tipo not in ('max_simultaneos', 'max_dias') or valor is not null)
);
alter table public.rrhh_reglas enable row level security;
revoke all on public.rrhh_reglas from anon, authenticated;
grant select, insert, update, delete on public.rrhh_reglas to authenticated;
drop policy if exists rrhh_reglas_select on public.rrhh_reglas;
create policy rrhh_reglas_select on public.rrhh_reglas for select to authenticated using (public.is_active_user());
drop policy if exists rrhh_reglas_write on public.rrhh_reglas;
create policy rrhh_reglas_write on public.rrhh_reglas for all to authenticated using (public.is_gerente()) with check (public.is_gerente());

-- Revisa las reglas para unas vacaciones (lanza el error con la regla que no se cumple).
create or replace function public.rrhh_revisar_reglas(p_colab uuid, p_desde date, p_hasta date, p_dias int) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  r public.rrhh_reglas;
  v_puesto text;
  v_dia date;
  v_n int;
begin
  select lower(trim(coalesce(e.puesto, p.rol::text, ''))) into v_puesto
    from public.rrhh_empleados e left join public.profiles p on p.id = e.profile_id where e.id = p_colab;
  for r in select * from public.rrhh_reglas where activo and tipo <> 'nota' loop
    if r.tipo = 'bloqueo' and p_desde <= r.hasta and p_hasta >= r.desde then
      raise exception 'Del % al % no se pueden pedir vacaciones%', to_char(r.desde, 'DD/MM/YYYY'), to_char(r.hasta, 'DD/MM/YYYY'),
        coalesce(': ' || nullif(trim(r.texto), ''), '');
    elsif r.tipo = 'max_dias' and p_dias > r.valor then
      raise exception 'Se pueden pedir máximo % días por solicitud%', r.valor, coalesce(' (' || nullif(trim(r.texto), '') || ')', '');
    elsif r.tipo = 'max_simultaneos' and (r.puesto is null or lower(trim(r.puesto)) = v_puesto) then
      for v_dia in select g::date from generate_series(p_desde, p_hasta, interval '1 day') g loop
        if not public.rrhh_es_laborable(v_dia) then continue; end if;
        select count(distinct s.colaborador_id)::int into v_n
          from public.rrhh_solicitudes s
          join public.rrhh_empleados e on e.id = s.colaborador_id
          left join public.profiles p on p.id = e.profile_id
         where s.tipo = 'vacaciones' and s.estado in ('pendiente', 'visto_jefe', 'aprobada') and s.colaborador_id <> p_colab
           and v_dia between s.desde and s.hasta
           and (r.puesto is null or lower(trim(coalesce(e.puesto, p.rol::text, ''))) = lower(trim(r.puesto)));
        if v_n >= r.valor then
          raise exception 'El % ya hay % de vacaciones%: máximo % a la vez', to_char(v_dia, 'DD/MM/YYYY'), v_n,
            coalesce(' de ' || r.puesto, ' en la empresa'), r.valor;
        end if;
      end loop;
    end if;
  end loop;
end;
$$;
revoke all on function public.rrhh_revisar_reglas(uuid, date, date, int) from public, anon, authenticated;

-- Las reglas se revisan al pedir vacaciones (si las registra la gerente, ella decide).
create or replace function public.rrhh_reglas_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'vacaciones' and new.estado in ('pendiente', 'visto_jefe') then
    perform public.rrhh_revisar_reglas(new.colaborador_id, new.desde, new.hasta, new.dias::int);
  end if;
  return new;
end;
$$;
drop trigger if exists rrhh_reglas_trg on public.rrhh_solicitudes;
create trigger rrhh_reglas_trg before insert on public.rrhh_solicitudes for each row execute function public.rrhh_reglas_trg();

-- Calendario: tambien las fechas bloqueadas.
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
    select 'bloqueo', r.desde, r.hasta, coalesce(nullif(trim(r.texto), ''), 'Sin vacaciones'), null, null, false, null, null
      from public.rrhh_reglas r where r.activo and r.tipo = 'bloqueo' and r.desde <= p_hasta and r.hasta >= p_desde
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

commit;
