-- =============================================================================
-- 0042_pagos_parciales.sql   (requiere 0032 ya aplicado)
-- Pagos parciales (anticipos) del CEO: si el CEO paga MENOS que el monto de una factura o anticipo,
-- se registra lo pagado y el resto queda automaticamente como un renglon nuevo "Por pagar"
-- (mismo numero de factura, con la nota "Saldo"). Asi el CEO puede pagar en partes.
-- No puede pagar MAS que el monto pendiente.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create or replace function public.pago_marcar_pagado(p_id uuid, p_fecha date, p_monto numeric, p_referencia text default null,
                                                     p_notas text default null, p_path text default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pagos; v_pagado numeric; v_saldo numeric := 0; v_nuevo uuid;
begin
  if not public.is_ceo() then raise exception 'Solo el CEO marca los pagos' using errcode = '42501'; end if;
  select * into p from public.pagos where id = p_id for update;
  if p.id is null then raise exception 'No encontrado'; end if;
  if p.estado <> 'pendiente' then raise exception 'Ya estaba marcado como pagado'; end if;
  if p_fecha is null then raise exception 'Escribe la fecha del pago'; end if;
  v_pagado := coalesce(p_monto, p.monto);
  if coalesce(v_pagado, 0) <= 0 then raise exception 'Escribe el monto pagado'; end if;
  if p.monto is not null then
    if v_pagado > p.monto + 0.005 then raise exception 'No puedes pagar mas que el monto pendiente (%)', to_char(p.monto, 'FM999,999,999.00'); end if;
    v_saldo := round(p.monto - v_pagado, 2);
  end if;
  if p_path is not null and p_path not like p_id::text || '/%' then raise exception 'Archivo invalido'; end if;

  perform set_config('esc.pago_rpc', '1', true);
  -- Pago parcial: lo que falta queda como saldo por pagar (con el mismo documento del proveedor).
  if v_saldo > 0 then
    insert into public.pagos (oc_id, tipo, numero_factura, fecha_factura, monto, fecha_limite, notas, estado, carga, carga_at,
                              factura_path, factura_nombre, created_by)
    values (p.oc_id, p.tipo, p.numero_factura, p.fecha_factura, v_saldo, p.fecha_limite,
            left('Saldo de ' || coalesce(p.numero_factura, case when p.tipo = 'anticipo' then 'anticipo' else 'factura' end)
                 || ' (se pago ' || to_char(v_pagado, 'FM999,999,999.00') || ' el ' || to_char(p_fecha, 'DD/MM/YYYY') || ')', 300),
            'pendiente', p.carga, p.carga_at, p.factura_path, p.factura_nombre, auth.uid())
    returning id into v_nuevo;
  end if;
  update public.pagos
     set estado = 'pagado', urgente = false, monto = case when v_saldo > 0 then v_pagado else monto end,
         notas = case when v_saldo > 0 then left(coalesce(notas || ' · ', '') || 'Pago parcial', 300) else notas end,
         pago_fecha = p_fecha, pago_monto = v_pagado,
         pago_referencia = nullif(left(trim(coalesce(p_referencia, '')), 120), ''),
         pago_notas = nullif(left(trim(coalesce(p_notas, '')), 500), ''),
         comprobante_path = p_path, comprobante_nombre = case when p_path is null then null else left(coalesce(p_nombre, 'comprobante'), 200) end,
         pagado_at = now(), pagado_por = auth.uid(), pagado_nombre = public.my_name()
   where id = p_id
   returning * into p;
  perform set_config('esc.pago_rpc', '', true);
  perform public.notify_role('comprador', 'pago_hecho',
    case when v_saldo > 0 then 'Pago parcial: ' else 'Pagado: ' end || public.pago_titulo(p),
    case when v_saldo > 0 then 'Se pagaron ' || to_char(v_pagado, 'FM999,999,999.00') || '; queda un saldo de ' || to_char(v_saldo, 'FM999,999,999.00') || ' por pagar'
         when p.comprobante_path is null then 'El CEO lo marco como pagado (sin comprobante todavia)'
         else 'Descarga el comprobante para mandarlo al proveedor' end,
    '/pagos/oc/' || p.oc_id, p.id);
end $$;

-- El saldo que crea el CEO al pagar en partes no le genera aviso a el mismo.
create or replace function public.pagos_aviso_ceo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_titulo text; v_cuerpo text;
begin
  if current_setting('esc.pago_rpc', true) = '1' then return null; end if;
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

commit;
