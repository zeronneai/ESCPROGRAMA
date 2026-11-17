-- =============================================================================
-- 0057_guias_recoleccion.sql
-- Guias de RECOLECCION con proveedor: compras sube la orden de compra (OC) y la guia es
-- del proveedor (origen, donde se recoge) hacia ESC (destino). Queda claro en la guia
-- de donde sale y a donde llega, y Marketplaces puede abrir la OC.
-- Se puede correr en cualquier momento (despues de 0056).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.guias
  add column if not exists sentido text not null default 'envio' check (sentido in ('envio', 'recoleccion')),
  add column if not exists origen_nombre text check (origen_nombre is null or length(trim(origen_nombre)) between 2 and 200),
  add column if not exists origen_contacto text check (origen_contacto is null or length(origen_contacto) <= 150),
  add column if not exists origen_telefono text check (origen_telefono is null or length(trim(origen_telefono)) between 7 and 40),
  add column if not exists origen_calle_numero text check (origen_calle_numero is null or length(trim(origen_calle_numero)) between 3 and 250),
  add column if not exists origen_colonia text check (origen_colonia is null or length(origen_colonia) <= 150),
  add column if not exists origen_cp text check (origen_cp is null or origen_cp ~ '^[0-9]{5}$'),
  add column if not exists origen_ciudad text check (origen_ciudad is null or length(trim(origen_ciudad)) between 2 and 120),
  add column if not exists origen_estado_geo text check (origen_estado_geo is null or length(trim(origen_estado_geo)) between 2 and 60),
  add column if not exists recoleccion_modo text check (recoleccion_modo is null or recoleccion_modo in ('recoleccion', 'proveedor_lleva')),
  add column if not exists recoleccion_fecha date,
  add column if not exists oc_path text,
  add column if not exists oc_nombre text check (oc_nombre is null or length(oc_nombre) <= 200);

-- En una recoleccion el origen (proveedor) va completo.
alter table public.guias drop constraint if exists guias_recoleccion_origen;
alter table public.guias add constraint guias_recoleccion_origen check (
  sentido = 'envio' or (origen_nombre is not null and origen_telefono is not null and origen_calle_numero is not null
                         and origen_cp is not null and origen_ciudad is not null and origen_estado_geo is not null
                         and recoleccion_modo is not null and recoleccion_fecha is not null));

grant insert (sentido, recoleccion_modo, recoleccion_fecha, origen_nombre, origen_contacto, origen_telefono, origen_calle_numero, origen_colonia, origen_cp, origen_ciudad, origen_estado_geo),
      update (sentido, recoleccion_modo, recoleccion_fecha, origen_nombre, origen_contacto, origen_telefono, origen_calle_numero, origen_colonia, origen_cp, origen_ciudad, origen_estado_geo)
  on public.guias to authenticated;

-- Avisos: en las recolecciones el titulo dice de que proveedor se recoge.
create or replace function public.guias_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_t text := case when new.sentido = 'recoleccion'
  then case when new.recoleccion_modo = 'proveedor_lleva' then 'Proveedor lo lleva' else 'Recoleccion' end
       || ' ' || coalesce(to_char(new.recoleccion_fecha, 'DD/MM'), '') || ' OC ' || new.factura || ' · ' || coalesce(new.origen_nombre, '') || ' a ESC · ' || coalesce(new.paqueteria_otra, new.paqueteria)
  else new.factura || ' · ' || new.destinatario || ' · ' || coalesce(new.paqueteria_otra, new.paqueteria) end;
begin
  if TG_OP = 'INSERT' then
    insert into public.guia_eventos (guia_id, tipo) values (new.id, 'alta');
    perform public.notify_role('marketplaces', 'guia_nueva', case when new.urgente then 'URGENTE: ' else '' end || 'Guia ' || v_t,
                               'Pide ' || new.vendedor_nombre, '/guias/' || new.id, new.id);
  elsif old.estado = 'requiere_datos' and new.estado = 'solicitada' then
    insert into public.guia_eventos (guia_id, tipo) values (new.id, 'reenviada');
    perform public.notify_user(new.atendida_por, 'guia_reenviada', 'Datos corregidos: ' || v_t, null, '/guias/' || new.id, new.id);
  end if;
  return null;
end $$;

-- La OC en PDF: la sube quien pidio la guia (en la carpeta de la guia).
create or replace function public.guia_oc(p_id uuid, p_path text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias;
begin
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.vendedor_id <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if p_path is null or p_path not like p_id::text || '/oc-%' then raise exception 'Archivo invalido'; end if;
  perform set_config('esc.guia_rpc', '1', true);
  update public.guias set oc_path = p_path, oc_nombre = left(coalesce(nullif(trim(p_nombre), ''), 'orden-de-compra.pdf'), 200) where id = p_id;
  perform set_config('esc.guia_rpc', '', true);
end $$;
revoke all on function public.guia_oc(uuid, text, text) from public, anon;
grant execute on function public.guia_oc(uuid, text, text) to authenticated;

drop policy if exists guias_oc_insert on storage.objects;
create policy guias_oc_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'guias' and (storage.foldername(name))[1] is not null and name like '%/oc-%'
              and exists (select 1 from public.guias g where g.id = public.storage_first_uuid(name) and g.vendedor_id = auth.uid()));

commit;
