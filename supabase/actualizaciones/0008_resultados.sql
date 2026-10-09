-- =============================================================================
-- 0008_resultados.sql
-- Que hace: resultado de la cotizacion (sin respuesta, ganada o perdida) y la funcion para que el
--           vendedor SOLICITE la actualizacion de una cotizacion con vigencia vencida.
--   * item_outcomes: un registro por version enviada al cliente, que nace "sin_respuesta".
--   * set_item_outcome(): el vendedor marca o corrige el resultado (todo queda en la bitacora).
--   * request_item_update(): "Solicitar actualizacion" (solo con vigencia vencida y sin resultado
--     ganada/perdida); pasa la partida a "actualizacion_solicitada" y avisa a los compradores.
--   * Indice para no repetir el aviso "sin resultado despues de 15 dias".
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- Depende de: 0007_vigencia_revisiones.sql.
-- =============================================================================

begin;

create type public.outcome_result as enum ('sin_respuesta', 'ganada', 'perdida');
create type public.loss_reason as enum
  ('precio_alto', 'tiempo_entrega', 'compra_minima', 'otro_proveedor', 'proyecto_cancelado', 'otro');

create table public.item_outcomes (
  item_id uuid not null references public.quote_items (id),
  quote_version smallint not null,
  resultado public.outcome_result not null default 'sin_respuesta',
  motivo public.loss_reason,
  motivo_texto text,
  cantidad_final numeric(14, 3) check (cantidad_final is null or cantidad_final > 0),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (item_id, quote_version),
  foreign key (item_id, quote_version) references public.item_dispatch (item_id, quote_version),
  check (resultado <> 'perdida' or motivo is not null),
  check (motivo is distinct from 'otro' or length(trim(coalesce(motivo_texto, ''))) > 0),
  check (resultado = 'perdida' or (motivo is null and motivo_texto is null)),
  check (resultado = 'ganada' or cantidad_final is null)
);
create index item_outcomes_resultado_idx on public.item_outcomes (resultado);
create trigger item_outcomes_updated before update on public.item_outcomes
  for each row execute function public.set_updated_at();
create trigger item_outcomes_no_delete before delete on public.item_outcomes
  for each row execute function public.forbid_mutation();
create trigger item_outcomes_audit after insert or update or delete on public.item_outcomes
  for each row execute function public.audit_row();

alter table public.item_outcomes enable row level security;
revoke all on public.item_outcomes from anon, authenticated;
grant select on public.item_outcomes to authenticated;
create policy outcomes_select on public.item_outcomes for select to authenticated
  using (public.can_read_request(public.item_request_id(item_id)));

-- Cada envio al cliente nace con resultado "sin_respuesta".
create or replace function public.item_dispatch_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.item_outcomes (item_id, quote_version) values (new.item_id, new.quote_version);
  return null;
end $$;
create trigger item_dispatch_outcome after insert on public.item_dispatch
  for each row execute function public.item_dispatch_outcome();

-- Los envios que ya existian reciben su resultado inicial.
insert into public.item_outcomes (item_id, quote_version)
select item_id, quote_version from public.item_dispatch
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- El vendedor marca o corrige el resultado de la version enviada mas reciente
-- ---------------------------------------------------------------------------
create or replace function public.set_item_outcome(
  p_item uuid, p_resultado public.outcome_result, p_motivo public.loss_reason default null,
  p_motivo_texto text default null, p_cantidad_final numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
declare r public.quote_requests; v_ver smallint;
begin
  select q.* into r from public.quote_requests q join public.quote_items i on i.request_id = q.id where i.id = p_item;
  if not found or r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select max(quote_version) into v_ver from public.item_dispatch where item_id = p_item;
  if v_ver is null then raise exception 'La partida aun no se marca como enviada al cliente'; end if;
  if p_resultado = 'perdida' and p_motivo is null then raise exception 'El motivo es obligatorio cuando se pierde la cotizacion'; end if;
  if p_motivo = 'otro' and length(trim(coalesce(p_motivo_texto, ''))) = 0 then
    raise exception 'Describe el motivo cuando eliges "otro"';
  end if;
  update public.item_outcomes
     set resultado = p_resultado,
         motivo = case when p_resultado = 'perdida' then p_motivo end,
         motivo_texto = case when p_resultado = 'perdida' then nullif(trim(coalesce(p_motivo_texto, '')), '') end,
         cantidad_final = case when p_resultado = 'ganada' then p_cantidad_final end,
         updated_by = auth.uid()
   where item_id = p_item and quote_version = v_ver;
end $$;

-- ---------------------------------------------------------------------------
-- "Solicitar actualizacion" (vendedor)
-- ---------------------------------------------------------------------------
create or replace function public.request_item_update(p_item uuid, p_nota text, p_due_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.quote_items; r public.quote_requests; q public.item_quotes; v_sla integer;
  v_res public.outcome_result; v_id uuid; b record;
begin
  select * into i from public.quote_items where id = p_item for update;
  if not found then raise exception 'Partida no encontrada'; end if;
  select * into r from public.quote_requests where id = i.request_id;
  if r.vendedor_id <> auth.uid() or not public.is_seller() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if i.estado not in ('cotizada', 'enviada_cliente') then
    raise exception 'Solo se puede pedir actualizacion de una partida cotizada';
  end if;
  select * into q from public.item_quotes where item_id = p_item order by version desc limit 1;
  if q.valid_until is null or q.valid_until >= now() then
    raise exception 'La cotizacion aun esta vigente';
  end if;
  select resultado into v_res from public.item_outcomes where item_id = p_item order by quote_version desc limit 1;
  if v_res in ('ganada', 'perdida') then
    raise exception 'La cotizacion ya tiene resultado (%): no se puede pedir actualizacion', v_res;
  end if;
  select sla_business_hours into v_sla from public.app_settings;
  if p_due_at is null or p_due_at < now() + make_interval(hours => v_sla) - interval '5 minutes'
     or p_due_at > now() + make_interval(hours => v_sla) + interval '30 days' then
    raise exception 'Fecha limite fuera del rango permitido';
  end if;

  insert into public.item_update_requests (item_id, quote_version, requested_by, nota, due_at)
  values (p_item, q.version, auth.uid(), nullif(trim(coalesce(p_nota, '')), ''), p_due_at)
  returning id into v_id;
  update public.quote_items set estado = 'actualizacion_solicitada' where id = p_item;

  for b in select id from public.profiles where rol = 'comprador' and activo loop
    perform public.notify_user(b.id, 'actualizacion_solicitada', 'Actualizacion solicitada ' || i.folio,
      i.producto || ': el vendedor pide actualizar la cotizacion.', '/comprador/solicitudes/' || r.id, v_id);
  end loop;
  return v_id;
end $$;

-- Aviso unico por partida: cotizacion enviada sin resultado despues de 15 dias.
create unique index notifications_dedupe_resultado_idx on public.notifications (user_id, tipo, ref_id)
  where tipo in ('sin_resultado', 'actualizacion_por_vencer', 'actualizacion_vencida');

-- Permisos
revoke all on function public.set_item_outcome(uuid, public.outcome_result, public.loss_reason, text, numeric) from public, anon;
grant execute on function public.set_item_outcome(uuid, public.outcome_result, public.loss_reason, text, numeric) to authenticated;
revoke all on function public.request_item_update(uuid, text, timestamptz) from public, anon;
grant execute on function public.request_item_update(uuid, text, timestamptz) to authenticated;
revoke all on function public.item_dispatch_outcome() from public, anon, authenticated;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACION (pegala en una consulta nueva):
--   select to_regclass('public.item_outcomes') is not null as tabla_creada;                         -- true
--   select (select count(*) from public.item_dispatch) = (select count(*) from public.item_outcomes)
--          as todos_los_envios_tienen_resultado;                                                     -- true
--   select proname from pg_proc where proname in ('set_item_outcome', 'request_item_update')
--    and pronamespace = 'public'::regnamespace;                                                      -- 2 filas
-- -----------------------------------------------------------------------------
