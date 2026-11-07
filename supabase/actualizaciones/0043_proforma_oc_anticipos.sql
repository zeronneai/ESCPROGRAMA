-- =============================================================================
-- 0043_proforma_oc_anticipos.sql   (requiere 0042 ya aplicado)
-- Para proveedores que mandan una PROFORMA con el total y luego facturan en partes:
--   * La proforma es un documento de REFERENCIA de la OC (numero, fecha, total y archivo). No se paga
--     ni se suma a "Facturas". Se puede reemplazar o quitar cuando cambie.
--   * Las facturas reales son lo que se suma y se paga.
--   * Anticipos: lo que se pago como anticipo se DESCUENTA de las facturas siguientes
--     ("anticipo aplicado"). El CEO paga solo lo neto (monto de la factura menos el anticipo aplicado),
--     asi nunca se paga doble.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- 1) Proforma en la OC
alter table public.ordenes_compra
  add column proforma_numero text check (proforma_numero is null or length(proforma_numero) <= 60),
  add column proforma_fecha date,
  add column proforma_monto numeric(14, 2) check (proforma_monto is null or proforma_monto > 0),
  add column proforma_path text,
  add column proforma_nombre text check (proforma_nombre is null or length(proforma_nombre) <= 200);
grant insert (proforma_numero, proforma_fecha, proforma_monto, proforma_path, proforma_nombre) on public.ordenes_compra to authenticated;
grant update (proforma_numero, proforma_fecha, proforma_monto, proforma_path, proforma_nombre) on public.ordenes_compra to authenticated;

-- Archivos de la proforma: carpeta con el id de la OC.
create policy pagos_storage_insert_oc on storage.objects for insert to authenticated
  with check (bucket_id = 'pagos' and public.is_buyer()
              and exists (select 1 from public.ordenes_compra o where o.id = public.storage_first_uuid(name)));

-- 2) Anticipo aplicado en facturas
alter table public.pagos add column anticipo_aplicado numeric(14, 2) not null default 0
  check (anticipo_aplicado >= 0);
alter table public.pagos add constraint pagos_anticipo_aplicado_valido
  check (anticipo_aplicado = 0 or (tipo = 'factura' and monto is not null and anticipo_aplicado <= monto));
grant insert (anticipo_aplicado) on public.pagos to authenticated;
grant update (anticipo_aplicado) on public.pagos to authenticated;

-- No se puede aplicar mas anticipo del que se ha pagado en la OC, y ya pagada la factura no cambia.
create or replace function public.pagos_anticipo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pagado numeric; v_aplicado numeric;
begin
  if current_setting('esc.pago_rpc', true) = '1' then return new; end if;
  if TG_OP = 'UPDATE' and old.estado <> 'pendiente' and new.anticipo_aplicado is distinct from old.anticipo_aplicado then
    raise exception 'Este pago ya se hizo: el anticipo aplicado ya no se puede cambiar';
  end if;
  if new.anticipo_aplicado > 0 then
    select coalesce(sum(coalesce(pago_monto, monto)), 0) into v_pagado from public.pagos
     where oc_id = new.oc_id and tipo = 'anticipo' and estado in ('pagado', 'cerrado');
    select coalesce(sum(anticipo_aplicado), 0) into v_aplicado from public.pagos
     where oc_id = new.oc_id and id <> new.id;
    if new.anticipo_aplicado > v_pagado - v_aplicado + 0.005 then
      raise exception 'Solo hay % de anticipo pagado sin aplicar', to_char(greatest(v_pagado - v_aplicado, 0), 'FM999,999,990.00');
    end if;
  end if;
  return new;
end $$;
create trigger pagos_anticipo_guard before insert or update of anticipo_aplicado, monto on public.pagos
  for each row execute function public.pagos_anticipo_guard();
revoke all on function public.pagos_anticipo_guard() from public, anon, authenticated;

-- 3) El CEO paga lo neto (monto menos anticipo aplicado); si paga menos, el resto queda como saldo.
create or replace function public.pago_marcar_pagado(p_id uuid, p_fecha date, p_monto numeric, p_referencia text default null,
                                                     p_notas text default null, p_path text default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pagos; v_neto numeric; v_pagado numeric; v_saldo numeric := 0;
begin
  if not public.is_ceo() then raise exception 'Solo el CEO marca los pagos' using errcode = '42501'; end if;
  select * into p from public.pagos where id = p_id for update;
  if p.id is null then raise exception 'No encontrado'; end if;
  if p.estado <> 'pendiente' then raise exception 'Ya estaba marcado como pagado'; end if;
  if p_fecha is null then raise exception 'Escribe la fecha del pago'; end if;
  v_neto := case when p.monto is null then null else p.monto - p.anticipo_aplicado end;
  v_pagado := coalesce(p_monto, v_neto);
  if coalesce(v_pagado, 0) <= 0 then raise exception 'Escribe el monto pagado'; end if;
  if v_neto is not null then
    if v_pagado > v_neto + 0.005 then raise exception 'No puedes pagar mas que el monto pendiente (%)', to_char(v_neto, 'FM999,999,990.00'); end if;
    v_saldo := round(v_neto - v_pagado, 2);
  end if;
  if p_path is not null and p_path not like p_id::text || '/%' then raise exception 'Archivo invalido'; end if;

  perform set_config('esc.pago_rpc', '1', true);
  if v_saldo > 0 then
    insert into public.pagos (oc_id, tipo, numero_factura, fecha_factura, monto, fecha_limite, notas, estado, carga, carga_at,
                              factura_path, factura_nombre, created_by)
    values (p.oc_id, p.tipo, p.numero_factura, p.fecha_factura, v_saldo, p.fecha_limite,
            left('Saldo de ' || coalesce(p.numero_factura, case when p.tipo = 'anticipo' then 'anticipo' else 'factura' end)
                 || ' (se pago ' || to_char(v_pagado, 'FM999,999,990.00') || ' el ' || to_char(p_fecha, 'DD/MM/YYYY') || ')', 300),
            'pendiente', p.carga, p.carga_at, p.factura_path, p.factura_nombre, auth.uid());
  end if;
  update public.pagos
     set estado = 'pagado', urgente = false,
         monto = case when v_saldo > 0 then v_pagado + anticipo_aplicado else monto end,
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
    case when v_saldo > 0 then 'Se pagaron ' || to_char(v_pagado, 'FM999,999,990.00') || '; queda un saldo de ' || to_char(v_saldo, 'FM999,999,990.00') || ' por pagar'
         when p.comprobante_path is null then 'El CEO lo marco como pagado (sin comprobante todavia)'
         else 'Descarga el comprobante para mandarlo al proveedor' end,
    '/pagos/oc/' || p.oc_id, p.id);
end $$;

commit;
