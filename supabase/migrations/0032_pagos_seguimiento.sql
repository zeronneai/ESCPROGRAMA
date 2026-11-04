-- =============================================================================
-- 0032_pagos_seguimiento.sql   (requiere 0031 ya aplicado)
-- Que cambia en Pagos a proveedores extranjeros:
--   * "Liberado" ya NO es permiso para pagar: es el seguimiento de la IMPORTACION (si el proveedor ya
--     libero la carga). El CEO puede pagar en cuanto el comprador registra la factura.
--   * Si la carga sigue sin liberar, el CEO lo ve: puede ser que el proveedor no la suelta hasta que se pague.
--   * El comprador puede marcar un pago como URGENTE y dejar un comentario para el CEO
--     (ej. "Pendiente de pago para liberacion"). Al CEO le llega aviso.
--   * Al CEO le llega aviso de cada factura nueva por pagar.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

alter table public.pagos
  add column carga text not null default 'sin_liberar' check (carga in ('sin_liberar', 'liberada')),
  add column carga_at timestamptz,
  add column urgente boolean not null default false;

-- Estatus de pago: Por pagar, Pagado o Pagado y enviado (historial).
alter table public.pagos drop constraint if exists pagos_estado_check;
alter table public.pagos disable trigger pagos_before;
update public.pagos
   set carga = case when estado = 'liberado' then 'liberada' else 'sin_liberar' end,
       carga_at = case when estado = 'liberado' then liberado_at end,
       estado = 'pendiente'
 where estado in ('por_liberar', 'en_espera', 'liberado');
alter table public.pagos enable trigger pagos_before;
alter table public.pagos alter column estado set default 'pendiente';
alter table public.pagos add constraint pagos_estado_check check (estado in ('pendiente', 'pagado', 'cerrado'));

grant update (carga, urgente, estado_nota) on public.pagos to authenticated;

create or replace function public.pagos_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('esc.pago_rpc', true) = '1' then return new; end if;
  if TG_OP = 'INSERT' then
    new.estado := 'pendiente';
    new.created_by := auth.uid();
    new.carga_at := case when new.carga = 'liberada' then now() end;
    return new;
  end if;
  if new.estado is distinct from old.estado then raise exception 'El estatus del pago se cambia con los botones del portal'; end if;
  if old.estado in ('pagado', 'cerrado') and new.monto is distinct from old.monto then
    raise exception 'Este pago ya se hizo: el monto ya no se puede cambiar';
  end if;
  if new.carga is distinct from old.carga then new.carga_at := case when new.carga = 'liberada' then now() end; end if;
  if old.estado <> 'pendiente' then new.urgente := false; end if;
  new.estado_nota := nullif(left(trim(coalesce(new.estado_nota, '')), 300), '');
  return new;
end $$;

create or replace function public.pagos_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado <> 'pendiente' then raise exception 'Solo se borran facturas que no se han pagado'; end if;
  return old;
end $$;

-- Avisos al CEO: factura nueva por pagar, marcada urgente o comentario nuevo del comprador.
create or replace function public.pagos_aviso_ceo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titulo text; v_cuerpo text;
begin
  if new.estado <> 'pendiente' then return null; end if;
  if new.urgente and (TG_OP = 'INSERT' or not old.urgente) then
    v_titulo := 'URGENTE: ' || public.pago_titulo(new);
    v_cuerpo := coalesce(new.estado_nota, case when new.carga = 'sin_liberar' then 'La carga sigue sin liberar' else 'Compras lo marco como urgente' end);
  elsif coalesce(new.monto, 0) > 0 and (TG_OP = 'INSERT' or old.monto is null) then
    v_titulo := 'Factura por pagar: ' || public.pago_titulo(new);
    v_cuerpo := coalesce(new.estado_nota, coalesce('Fecha limite ' || to_char(new.fecha_limite, 'DD/MM/YYYY'), 'Registrada por compras'));
  elsif TG_OP = 'UPDATE' and new.estado_nota is not null and new.estado_nota is distinct from old.estado_nota then
    v_titulo := 'Comentario de compras: ' || public.pago_titulo(new);
    v_cuerpo := new.estado_nota;
  else
    return null;
  end if;
  perform public.notify_role('ceo', case when new.urgente then 'pago_urgente' else 'pago_pendiente' end, v_titulo, v_cuerpo, '/pagos/oc/' || new.oc_id, new.id);
  return null;
end $$;
create trigger pagos_aviso_ceo after insert or update of monto, urgente, estado_nota on public.pagos
  for each row execute function public.pagos_aviso_ceo();
revoke all on function public.pagos_aviso_ceo() from public, anon, authenticated;

-- Ya no existe "liberar para pago".
drop function if exists public.pago_estado(uuid, text, text);

create or replace function public.pago_deshacer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ceo() then raise exception 'No autorizado' using errcode = '42501'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos
     set estado = 'pendiente', pago_fecha = null, pago_monto = null, pago_referencia = null, pago_notas = null,
         comprobante_path = null, comprobante_nombre = null, pagado_at = null, pagado_por = null, pagado_nombre = null
   where id = p_id and estado = 'pagado';
  if not found then raise exception 'Solo se deshace un pago que el comprador aun no archiva'; end if;
  perform set_config('esc.pago_rpc', '', true);
end $$;

-- Al pagar se quita lo urgente.
create or replace function public.pago_marcar_pagado(p_id uuid, p_fecha date, p_monto numeric, p_referencia text default null,
                                                     p_notas text default null, p_path text default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pagos;
begin
  if not public.is_ceo() then raise exception 'Solo el CEO marca los pagos' using errcode = '42501'; end if;
  select * into p from public.pagos where id = p_id for update;
  if p.id is null then raise exception 'No encontrado'; end if;
  if p.estado <> 'pendiente' then raise exception 'Ya estaba marcado como pagado'; end if;
  if p_fecha is null then raise exception 'Escribe la fecha del pago'; end if;
  if coalesce(p_monto, p.monto, 0) <= 0 then raise exception 'Escribe el monto pagado'; end if;
  if p_path is not null and p_path not like p_id::text || '/%' then raise exception 'Archivo invalido'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos
     set estado = 'pagado', urgente = false, pago_fecha = p_fecha, pago_monto = coalesce(p_monto, p.monto),
         pago_referencia = nullif(left(trim(coalesce(p_referencia, '')), 120), ''),
         pago_notas = nullif(left(trim(coalesce(p_notas, '')), 500), ''),
         comprobante_path = p_path, comprobante_nombre = case when p_path is null then null else left(coalesce(p_nombre, 'comprobante'), 200) end,
         pagado_at = now(), pagado_por = auth.uid(), pagado_nombre = public.my_name()
   where id = p_id
   returning * into p;
  perform set_config('esc.pago_rpc', '', true);
  perform public.notify_role('comprador', 'pago_hecho', 'Pagado: ' || public.pago_titulo(p),
    case when p.comprobante_path is null then 'El CEO lo marco como pagado (sin comprobante todavia)' else 'Descarga el comprobante para mandarlo al proveedor' end,
    '/pagos/oc/' || p.oc_id, p.id);
end $$;

-- Tarea diaria: recuerda al CEO lo urgente y lo que vence en 2 dias o menos.
create or replace function public.pagos_recordatorio() returns integer
language plpgsql security definer set search_path = public as $$
declare r public.pagos; n integer := 0;
begin
  for r in select * from public.pagos
            where estado = 'pendiente' and (urgente or (fecha_limite is not null and fecha_limite <= public.local_today() + 2)) loop
    insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
    select pr.id, 'pago_por_vencer',
           case when r.urgente then 'URGENTE: '
                when r.fecha_limite < public.local_today() then 'Pago vencido: ' else 'Pago por vencer: ' end || public.pago_titulo(r),
           coalesce(r.estado_nota, 'Fecha limite ' || to_char(r.fecha_limite, 'DD/MM/YYYY'), 'Pendiente de pago'), '/pagos/oc/' || r.oc_id, r.id
      from public.profiles pr where pr.rol = 'ceo' and pr.activo;
    n := n + 1;
  end loop;
  return n;
end $$;

commit;
