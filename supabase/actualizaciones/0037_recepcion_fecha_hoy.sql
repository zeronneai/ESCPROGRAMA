-- =============================================================================
-- 0037_recepcion_fecha_hoy.sql   (requiere 0035 ya aplicado)
-- La fecha de una recepcion (y de sus etiquetas) es SIEMPRE el dia en que se registra en el portal.
-- Ya no se puede poner otra fecha, ni desde la pantalla ni mandandola directo a la base.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- p_fecha se conserva solo por compatibilidad y se ignora.
create or replace function public.recepcion_crear(p_tipo text, p_fecha date, p_orden_compra text, p_proveedor text,
                                                  p_notas text, p_lineas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_hoy date := public.local_today(); v_id uuid; l jsonb; v_linea uuid; v_art uuid; v_cant integer; v_total integer := 0;
begin
  if not public.is_almacen() then raise exception 'Solo almacen registra recepciones' using errcode = '42501'; end if;
  if p_tipo not in ('compra', 'inventario_inicial', 'devolucion', 'ajuste') then raise exception 'Tipo invalido'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'Agrega al menos un articulo'; end if;
  insert into public.recepciones (tipo, fecha, orden_compra, proveedor, notas)
  values (p_tipo, v_hoy, nullif(trim(coalesce(p_orden_compra, '')), ''),
          nullif(trim(coalesce(p_proveedor, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_art := (l ->> 'articulo_id')::uuid;
    v_cant := (l ->> 'cantidad')::integer;
    if v_cant is null or v_cant < 1 or v_cant > 2000 then raise exception 'Cantidad invalida (1 a 2000)'; end if;
    if not exists (select 1 from public.articulos where id = v_art) then raise exception 'Articulo no encontrado'; end if;
    v_total := v_total + v_cant;
    if v_total > 3000 then raise exception 'Maximo 3000 etiquetas por recepcion'; end if;
    insert into public.recepcion_lineas (recepcion_id, articulo_id, cantidad, lote)
    values (v_id, v_art, v_cant, nullif(trim(coalesce(l ->> 'lote', '')), '')) returning id into v_linea;
    insert into public.etiquetas (articulo_id, recepcion_id, linea_id, recibida)
    select v_art, v_id, v_linea, v_hoy from generate_series(1, v_cant);
  end loop;
  return v_id;
end $$;

commit;
