-- =============================================================================
-- 0054_guias_varios_archivos.sql
-- Guias: Marketplaces puede subir VARIOS archivos de guia (uno por bulto o tarima), cada uno con su
-- numero de guia. Sirve para paqueterias que generan una guia por peso. El vendedor ve todos los
-- numeros de guia; los archivos los descargan Marketplaces y los jefes.
-- Se puede correr en cualquier momento (despues de 0052).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.guias add column if not exists archivos jsonb not null default '[]'::jsonb
  check (jsonb_typeof(archivos) = 'array' and jsonb_array_length(archivos) <= 30);

-- Las guias que ya tenian archivo pasan a la lista.
update public.guias set archivos = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'path', archivo_path, 'nombre', coalesce(archivo_nombre, 'guia.pdf'), 'rastreo', numero_rastreo, 'at', coalesce(lista_at, now()))))
 where archivo_path is not null and archivos = '[]'::jsonb;

-- Resumen en las columnas de siempre: el primer archivo y todos los numeros de guia.
create or replace function public.guias_archivos_resumen(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  select archivos into a from public.guias where id = p_id;
  update public.guias set
    archivo_path = a -> 0 ->> 'path',
    archivo_nombre = a -> 0 ->> 'nombre',
    numero_rastreo = left(nullif((select string_agg(e ->> 'rastreo', ', ') from jsonb_array_elements(a) e where coalesce(e ->> 'rastreo', '') <> ''), ''), 80)
  where id = p_id;
end $$;
revoke all on function public.guias_archivos_resumen(uuid) from public, anon, authenticated;

-- Marketplaces agrega un archivo de guia (con su numero y, opcional, para que bulto es).
create or replace function public.guia_archivo_agregar(p_id uuid, p_path text, p_nombre text, p_rastreo text, p_bulto text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias; v_t text; v_n integer; v_r text := left(trim(coalesce(p_rastreo, '')), 80); v_b text := nullif(left(trim(coalesce(p_bulto, '')), 80), '');
begin
  if not public.is_marketplaces() then raise exception 'Solo Marketplaces sube las guias' using errcode = '42501'; end if;
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.estado = 'cancelada' then raise exception 'Guia no disponible'; end if;
  if v.estado not in ('solicitada', 'en_proceso', 'lista') then raise exception 'No se puede subir la guia en este paso'; end if;
  if p_path is null or p_path not like p_id::text || '/%' then raise exception 'Sube el archivo de la guia'; end if;
  if length(v_r) < 3 then raise exception 'Escribe el numero de guia'; end if;
  if jsonb_array_length(v.archivos) >= 30 then raise exception 'Maximo 30 archivos por guia'; end if;
  v_t := v.factura || ' · ' || v.destinatario || ' · ' || coalesce(v.paqueteria_otra, v.paqueteria);
  perform set_config('esc.guia_rpc', '1', true);
  update public.guias set
    archivos = archivos || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('path', p_path, 'nombre', left(coalesce(nullif(trim(p_nombre), ''), 'guia.pdf'), 200), 'rastreo', v_r, 'bulto', v_b, 'at', now()))),
    archivo_path = coalesce(archivo_path, p_path), archivo_nombre = coalesce(archivo_nombre, left(coalesce(nullif(trim(p_nombre), ''), 'guia.pdf'), 200)),
    estado = 'lista', lista_at = coalesce(lista_at, now()), mensaje = null,
    atendida_por = coalesce(atendida_por, auth.uid()), atendida_nombre = coalesce(atendida_nombre, public.my_name())
  where id = p_id
  returning jsonb_array_length(archivos) into v_n;
  perform public.guias_archivos_resumen(p_id);
  perform set_config('esc.guia_rpc', '', true);
  perform public.notify_user(v.vendedor_id, 'guia_lista',
    case when v_n = 1 then 'Guia lista: ' else 'Otra guia lista (' || v_n || '): ' end || v_t,
    'Numero de guia ' || v_r || coalesce(' · ' || v_b, ''), '/guias/' || p_id, p_id);
  insert into public.guia_eventos (guia_id, tipo, nota)
  values (p_id, 'lista', 'Guia ' || v_n || ' · Rastreo: ' || v_r || coalesce(' · ' || v_b, ''));
end $$;
revoke all on function public.guia_archivo_agregar(uuid, text, text, text, text) from public, anon;
grant execute on function public.guia_archivo_agregar(uuid, text, text, text, text) to authenticated;

-- Marketplaces quita un archivo (se equivoco). Si ya no queda ninguno, regresa a "generando".
create or replace function public.guia_archivo_quitar(p_id uuid, p_idx integer) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias; e jsonb;
begin
  if not public.is_marketplaces() then raise exception 'Solo Marketplaces quita las guias' using errcode = '42501'; end if;
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.estado <> 'lista' then raise exception 'Guia no disponible'; end if;
  e := v.archivos -> p_idx;
  if p_idx is null or p_idx < 0 or e is null then raise exception 'Archivo invalido'; end if;
  perform set_config('esc.guia_rpc', '1', true);
  if jsonb_array_length(v.archivos) = 1 then
    update public.guias set archivos = '[]'::jsonb, estado = 'en_proceso', lista_at = null, archivo_path = null, archivo_nombre = null, numero_rastreo = null where id = p_id;
  else
    update public.guias set archivos = archivos - p_idx where id = p_id;
    perform public.guias_archivos_resumen(p_id);
  end if;
  perform set_config('esc.guia_rpc', '', true);
  insert into public.guia_eventos (guia_id, tipo, nota)
  values (p_id, 'comentario', 'Marketplaces quito la guia ' || coalesce(e ->> 'rastreo', e ->> 'nombre'));
end $$;
revoke all on function public.guia_archivo_quitar(uuid, integer) from public, anon;
grant execute on function public.guia_archivo_quitar(uuid, integer) to authenticated;

commit;
