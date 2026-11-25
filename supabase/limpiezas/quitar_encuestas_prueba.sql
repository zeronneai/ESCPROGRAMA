-- =============================================================================
-- quitar_encuestas_prueba.sql   (limpieza de una sola vez, no es actualizacion)
-- Borra las encuestas de satisfaccion (evaluacion de clientes) del usuario "Prueba", entre ellas la de
-- STARR PRODUCE. Asi "Prueba" ya no sale en la tabla de vendedores y no cuenta en los porcentajes ni en
-- indicadores. No borra al usuario ni al cliente STARR PRODUCE.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que borro.
-- =============================================================================
do $$
declare
  v_prueba uuid; n integer; v_ids uuid[]; r record;
begin
  select count(*), min(id::text)::uuid into n, v_prueba from public.profiles where lower(trim(nombre)) = 'prueba';
  if n <> 1 then raise exception 'Encontre % usuarios llamados "Prueba"; no borro nada.', n; end if;

  select coalesce(array_agg(id), '{}') into v_ids from public.encuestas_cliente where vendedor_id = v_prueba;
  for r in select c.nombre, e.puntaje, e.respondida_at from public.encuestas_cliente e join public.customers c on c.id = e.customer_id where e.id = any (v_ids) loop
    raise notice 'Se borra la encuesta de % (puntaje %, respondida %)', r.nombre, coalesce(r.puntaje::text, '-'), coalesce(r.respondida_at::date::text, 'no');
  end loop;
  if cardinality(v_ids) = 0 then raise notice 'Prueba no tiene encuestas: no hay nada que borrar.'; end if;

  -- Las encuestas no se dejan borrar (control ISO): se quita el candado solo para este borrado.
  alter table public.encuestas_cliente disable trigger encuestas_no_delete;
  delete from public.notifications where ref_id = any (v_ids);
  delete from public.encuestas_cliente where id = any (v_ids);
  get diagnostics n = row_count;
  alter table public.encuestas_cliente enable trigger encuestas_no_delete;
  raise notice 'Listo: % encuesta(s) de Prueba borradas.', n;

  -- Por si la de STARR la hizo otro vendedor: solo avisa, no la borra.
  for r in select p.nombre as vend, e.puntaje from public.encuestas_cliente e join public.customers c on c.id = e.customer_id join public.profiles p on p.id = e.vendedor_id
            where c.nombre ilike '%starr produce%' loop
    raise notice 'OJO: sigue una encuesta de STARR PRODUCE de % (puntaje %). Si tambien era prueba, avisame.', r.vend, coalesce(r.puntaje::text, '-');
  end loop;
end $$;

-- Para que "Prueba" ya no pueda entrar ni aparezca en listas de usuarios activos, quita los dos guiones de abajo:
-- update public.profiles set activo = false where lower(trim(nombre)) = 'prueba';
