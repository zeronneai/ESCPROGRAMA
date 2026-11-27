-- =============================================================================
-- 0094_marketplaces_jefa.sql   (requiere 0093)
-- MARKETPLACES ES DEL EQUIPO DE LA JEFA DE VENTAS
--  * Sus vacaciones y permisos: primero la jefa de ventas y luego la gerente.
--  * Su consumo interno lo aprueba la jefa de ventas (como el de los vendedores).
--  * Lo que ya estaba esperando se pasa a la jefa.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.rrhh_jefe_rol(p_colab uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when e.profile_id is null then coalesce(e.jefe_rol, 'supervisor_almacen')
    else case p.rol::text when 'vendedor' then 'jefe_ventas' when 'marketplaces' then 'jefe_ventas'
      when 'aux_finanzas' then 'supervisor_finanzas' when 'almacen' then 'supervisor_almacen' end end
  from public.rrhh_empleados e left join public.profiles p on p.id = e.profile_id where e.id = p_colab;
$$;

create or replace function public.consumo_aprobador(p_uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p.rol::text when 'vendedor' then 'jefe_ventas' when 'marketplaces' then 'jefe_ventas'
    when 'gerente' then null when 'ceo' then null else 'gerente' end
    from public.profiles p where p.id = p_uid;
$$;

update public.consumo_solicitudes set aprobador_rol = public.consumo_aprobador(solicitante_id) where estado = 'por_aprobar';
update public.rrhh_solicitudes set jefe_rol = public.rrhh_jefe_rol(colaborador_id) where estado = 'pendiente' and registro_por is not distinct from empleado_id;

commit;
