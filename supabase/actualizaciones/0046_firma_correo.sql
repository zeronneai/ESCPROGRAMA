-- =============================================================================
-- 0046_firma_correo.sql   (requiere 0045 ya aplicado)
-- Firma de correo: cada usuario llena sus datos (nombre, puesto, correo, telefono, direccion y la
-- leyenda del link de quejas) y descarga la imagen para su correo. Se guarda para la proxima vez.
-- A vendedores y jefa de ventas les aparece sola al entrar hasta que la descarguen.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.profiles
  add column firma jsonb check (firma is null or (jsonb_typeof(firma) = 'object' and octet_length(firma::text) <= 4000)),
  add column firma_at timestamptz,
  add column firma_pospuesta_at timestamptz;

-- Guarda la firma propia (al descargarla).
create or replace function public.guardar_mi_firma(p_firma jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '42501'; end if;
  if p_firma is null or jsonb_typeof(p_firma) <> 'object' or octet_length(p_firma::text) > 4000 then
    raise exception 'Firma inválida';
  end if;
  update public.profiles set firma = p_firma, firma_at = now() where id = auth.uid();
end $$;

-- "Ahora no": no vuelve a salir sola en un dia.
create or replace function public.posponer_mi_firma() returns void
language sql security definer set search_path = public as $$
  update public.profiles set firma_pospuesta_at = now() where id = auth.uid();
$$;

revoke all on function public.guardar_mi_firma(jsonb), public.posponer_mi_firma() from public, anon;
grant execute on function public.guardar_mi_firma(jsonb), public.posponer_mi_firma() to authenticated;

commit;
