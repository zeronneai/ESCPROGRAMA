-- =============================================================================
-- 0063_cotizar_sin_esperar_aclaracion.sql   (requiere 0010)
-- El comprador puede seguir (cotizar o marcar no encontrada) aunque el vendedor no haya contestado la
-- aclaracion: se cierra la pausa (el reloj vuelve a correr desde ese momento), la partida regresa a su
-- estado anterior y queda un mensaje en la conversacion. El vendedor todavia puede contestar despues.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;
create or replace function public.continuar_sin_aclaracion(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i public.quote_items; r public.quote_requests; v_pause public.item_clarification_pauses;
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  if i.estado <> 'esperando_aclaracion' then return i.estado::text; end if;
  select * into r from public.quote_requests where id = i.request_id;
  select * into v_pause from public.item_clarification_pauses where item_id = p_item and resumed_at is null for update;
  if found then
    update public.item_clarification_pauses set resumed_at = now(), resumed_by = auth.uid() where id = v_pause.id;
  end if;
  insert into public.item_messages (item_id, author_id, author_rol, kind, body)
  values (p_item, auth.uid(), 'comprador', 'mensaje', 'Compras siguió con la cotización sin esperar la aclaración.');
  update public.quote_items set estado = coalesce(v_pause.estado_previo, 'pendiente') where id = p_item;
  return coalesce(v_pause.estado_previo, 'pendiente')::text;
end $$;
revoke all on function public.continuar_sin_aclaracion(uuid) from public, anon;
grant execute on function public.continuar_sin_aclaracion(uuid) to authenticated;
commit;
