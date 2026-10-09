-- =============================================================================
-- Primer comprador-administrador
-- =============================================================================
-- ANTES: en Supabase > Authentication > Users > Add user > "Create new user",
--        escribe tu correo y una contrasena, y marca "Auto Confirm User".
-- AHORA: cambia SOLO las dos lineas marcadas con (CAMBIA) y presiona Run
--        en SQL Editor. Despues entra al portal con ese correo y contrasena.
-- Es seguro correrlo de nuevo: si ya existe, lo deja como comprador activo.
-- =============================================================================
do $$
declare
  v_correo text := lower('tu-correo@empresa.com');   -- (CAMBIA) el mismo correo que creaste en Authentication
  v_nombre text := 'Tu Nombre';                       -- (CAMBIA) tu nombre completo
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = v_correo;
  if v_id is null then
    raise exception 'No existe un usuario con el correo "%". Crealo primero en Authentication > Users > Add user.', v_correo;
  end if;

  insert into public.profiles (id, nombre, correo, rol, activo, must_change_password)
  values (v_id, trim(v_nombre), v_correo, 'comprador', true, false)
  on conflict (id) do update
    set rol = 'comprador', activo = true, nombre = excluded.nombre, must_change_password = false;

  raise notice 'Listo: % ahora es comprador (administrador).', v_correo;
end $$;
