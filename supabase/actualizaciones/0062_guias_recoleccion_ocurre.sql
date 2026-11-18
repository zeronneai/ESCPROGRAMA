-- =============================================================================
-- 0062_guias_recoleccion_ocurre.sql   (requiere 0057)
-- Guias de los vendedores: eligen si el envio es RECOLECCION (la paqueteria pasa a recogerlo) u OCURRE
-- (se entrega en la sucursal de la paqueteria). Marketplaces lo ve en grande en la guia y en el aviso.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;
alter table public.guias add column if not exists entrega_modo text;
alter table public.guias drop constraint if exists guias_entrega_modo_check;
alter table public.guias add constraint guias_entrega_modo_check check (entrega_modo is null or entrega_modo in ('recoleccion', 'ocurre'));
grant insert (entrega_modo), update (entrega_modo) on public.guias to authenticated;

-- El aviso a Marketplaces empieza con RECOLECCION u OCURRE.
create or replace function public.guias_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_t text := case when new.sentido = 'recoleccion'
  then case when new.recoleccion_modo = 'proveedor_lleva' then 'Proveedor lo lleva' else 'Recoleccion' end
       || ' ' || coalesce(to_char(new.recoleccion_fecha, 'DD/MM'), '') || ' OC ' || new.factura || ' · ' || coalesce(new.origen_nombre, '') || ' a ESC · ' || coalesce(new.paqueteria_otra, new.paqueteria)
  else case new.entrega_modo when 'ocurre' then 'OCURRE · ' when 'recoleccion' then 'RECOLECCION · ' else '' end
       || new.factura || ' · ' || new.destinatario || ' · ' || coalesce(new.paqueteria_otra, new.paqueteria) end;
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
commit;
