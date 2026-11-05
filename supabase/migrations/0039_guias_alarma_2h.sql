-- =============================================================================
-- 0039_guias_alarma_2h.sql   (requiere 0021 ya aplicado)
-- Guias de paqueteria: se atienden rapido. Alarma a la 1 hora y alerta roja fuerte a las 2 horas
-- (antes 4 y 24). El vendedor ya puede mandar recordatorio a Marketplaces a partir de 1 hora
-- (maximo uno por hora).
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.guia_recordar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.guias; v_min integer;
begin
  select * into v from public.guias where id = p_id for update;
  if v.id is null or v.vendedor_id <> auth.uid() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if v.estado not in ('solicitada', 'en_proceso') then raise exception 'Esta guia no esta pendiente'; end if;
  if now() - v.solicitada_at < interval '1 hour' then raise exception 'Podras recordar cuando pase 1 hora desde la solicitud'; end if;
  if v.ultimo_recordatorio_at is not null and now() - v.ultimo_recordatorio_at < interval '1 hour' then
    raise exception 'Ya enviaste un recordatorio hace menos de una hora';
  end if;
  perform set_config('esc.guia_rpc', '1', true);
  update public.guias set recordatorios = recordatorios + 1, ultimo_recordatorio_at = now() where id = p_id;
  perform set_config('esc.guia_rpc', '', true);
  insert into public.guia_eventos (guia_id, tipo) values (p_id, 'recordatorio');
  v_min := floor(extract(epoch from now() - v.solicitada_at) / 60)::int;
  insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
  select id, 'guia_recordatorio',
         left(case when v_min >= 120 then 'ATRASADA: guia ' else 'Recordatorio: guia ' end || v.factura || ' · ' || v.destinatario || ' · ' || coalesce(v.paqueteria_otra, v.paqueteria), 200),
         'Solicitada por ' || v.vendedor_nombre || ' hace ' || case when v_min < 120 then v_min || ' min' else floor(v_min / 60) || ' horas' end,
         '/guias/' || p_id, p_id
    from public.profiles where rol = 'marketplaces' and activo;
end $$;

commit;
