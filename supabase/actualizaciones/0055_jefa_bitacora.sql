-- =============================================================================
-- 0055_jefa_bitacora.sql
-- La jefa de ventas tambien vende: lleva SU propia bitacora (prospeccion, ventas diarias,
-- visitas y ventas con factura) igual que los vendedores. Sigue viendo la de todo el equipo.
-- Lo que registra queda a su nombre; no puede editar lo de los vendedores.
-- Se puede correr en cualquier momento (despues de 0054).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- "Vende": vendedores y jefa de ventas. Todas las reglas de "lo mio" (bitacora, ventas,
-- clientes, guias, cotizaciones) aplican a la jefa sobre sus propios registros.
create or replace function public.is_seller() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and not must_change_password and rol in ('vendedor', 'jefe_ventas')
  );
$$;

-- Solo el vendedor (no la jefa) para lo que se le oculta a los vendedores.
create or replace function public.is_vendedor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and not must_change_password and rol = 'vendedor'
  );
$$;
grant execute on function public.is_vendedor() to authenticated;

-- El archivo de la guia: el vendedor solo ve el numero; la jefa lo sigue descargando.
drop policy if exists guias_storage_select on storage.objects;
create policy guias_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'guias' and not public.is_vendedor() and public.can_read_guia(public.storage_first_uuid(name)));

commit;
