-- =============================================================================
-- 0064_pegatron_linea_sobrepedido.sql   (requiere 0053)
-- Pedidos Pegatron en dos secciones:
--  * linea: productos de linea (importacion). Lo que falta por pedir entra a la planeacion de compras.
--  * sobrepedido: productos locales o no comunes.
-- La jefa de ventas elige la seccion al subir la OC (y la puede cambiar despues).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;
alter table public.pegatron_oc add column if not exists tipo text not null default 'linea';
alter table public.pegatron_oc drop constraint if exists pegatron_oc_tipo_check;
alter table public.pegatron_oc add constraint pegatron_oc_tipo_check check (tipo in ('linea', 'sobrepedido'));
create index if not exists pegatron_oc_tipo_idx on public.pegatron_oc (tipo);

-- Alta de la OC con su seccion.
create or replace function public.pegatron_crear(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_po text := upper(trim(coalesce(p ->> 'po_numero', ''))); l jsonb; i integer := 0;
        v_tipo text := coalesce(nullif(p ->> 'tipo', ''), 'linea');
begin
  if not public.pegatron_puede_subir() then raise exception 'Solo la jefa de ventas sube pedidos de Pegatron' using errcode = '42501'; end if;
  if v_tipo not in ('linea', 'sobrepedido') then raise exception 'Elige si es de linea o sobrepedido'; end if;
  if length(v_po) < 3 then raise exception 'Falta el numero de la orden de compra (P/O)'; end if;
  if exists (select 1 from public.pegatron_oc where upper(po_numero) = v_po) then
    raise exception 'La orden de compra % ya se subio', v_po;
  end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'La orden no tiene renglones'; end if;
  if jsonb_array_length(p -> 'lineas') > 200 then raise exception 'Demasiados renglones'; end if;
  insert into public.pegatron_oc (po_numero, fecha, moneda, notas, autor_nombre, tipo)
  values (v_po, nullif(p ->> 'fecha', '')::date, nullif(p ->> 'moneda', ''), nullif(left(trim(coalesce(p ->> 'notas', '')), 1000), ''), public.my_name(), v_tipo)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p -> 'lineas') loop
    i := i + 1;
    if length(trim(coalesce(l ->> 'articulo_esc', ''))) < 2 then
      raise exception 'Renglon %: escribe el articulo ESC', i;
    end if;
    insert into public.pegatron_oc_lineas (oc_id, posicion, item, numero_parte, descripcion, cantidad, unidad, entrega, articulo_esc)
    values (v_id, i, nullif(left(l ->> 'item', 20), ''), nullif(left(l ->> 'numero_parte', 80), ''), left(trim(l ->> 'descripcion'), 500),
            (l ->> 'cantidad')::numeric, nullif(left(l ->> 'unidad', 20), ''), nullif(l ->> 'entrega', '')::date, left(trim(l ->> 'articulo_esc'), 200));
  end loop;
  perform public.notify_role('comprador', 'pegatron_oc',
                             'Pedido Pegatron ' || v_po || case when v_tipo = 'sobrepedido' then ' (sobrepedido)' else ' (de linea)' end,
                             i || ' articulo(s) por pedir', '/pedidos-pegatron/' || v_id, v_id);
  return v_id;
end $$;
revoke all on function public.pegatron_crear(jsonb) from public, anon;
grant execute on function public.pegatron_crear(jsonb) to authenticated;

-- La jefa cambia la seccion de una OC.
create or replace function public.pegatron_tipo(p_id uuid, p_tipo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pegatron_puede_subir() then raise exception 'Solo la jefa de ventas cambia la seccion' using errcode = '42501'; end if;
  if p_tipo not in ('linea', 'sobrepedido') then raise exception 'Seccion invalida'; end if;
  update public.pegatron_oc set tipo = p_tipo where id = p_id;
  if not found then raise exception 'Orden no encontrada'; end if;
end $$;
revoke all on function public.pegatron_tipo(uuid, text) from public, anon;
grant execute on function public.pegatron_tipo(uuid, text) to authenticated;
commit;
