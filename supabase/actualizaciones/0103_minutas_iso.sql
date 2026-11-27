-- =============================================================================
-- 0103_minutas_iso.sql   (requiere 0031)
-- MINUTAS: EL COORDINADOR ISO VE TODAS Y TAMBIEN PUEDE HACERLAS
--  * Ve todas las minutas aunque no lo incluyan (igual que la gerente).
--  * Puede hacer minutas como los jefes de departamento.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.can_read_minuta(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.minutas m where m.id = p_id and (m.created_by = auth.uid() or public.is_gerente() or public.is_iso()))
      or exists (select 1 from public.minuta_firmas f join public.minutas m on m.id = f.minuta_id
                  where f.minuta_id = p_id and f.user_id = auth.uid() and m.estado = 'enviada');
$$;

create or replace function public.is_jefe_depto() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and not must_change_password
                  and rol in ('jefe_ventas', 'gerente', 'comprador', 'supervisor_almacen', 'supervisor_finanzas', 'ceo', 'coordinador_iso'));
$$;

commit;
