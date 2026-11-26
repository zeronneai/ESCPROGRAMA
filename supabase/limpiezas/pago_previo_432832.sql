-- =============================================================================
-- pago_previo_432832.sql   (requiere 0087; de una sola vez)
-- Marca como "Identificado antes del portal" el abono de $432,832.84 (19 de noviembre, Pegatron) con sus
-- 33 facturas, a nombre de Alejandra Rangel (a ella le sale en "Los mios"). Queda identificado, ya no sale
-- pendiente y nadie lo puede tomar ni cambiar (finanzas tampoco).
-- Si ya lo habias corrido antes, solo se lo asigna a Alejandra Rangel.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que hizo.
-- =============================================================================
do $$
declare
  v_mov uuid;
  v_ale uuid;
  v_nombre text;
  n int;
  v_folios text[] := array[
    'F10815','F10817','F10785','F10693','F10822','F10942','F10946','F10945','F10944','F10943','F10953',
    'F10964','F10992','F9585','F9847','F10125','F10102','F10386','F10625','F10626','F10629','F10627',
    'F10630','F10631','F10632','F10619','F10676','F10659','F10645','F10759','F10708','F10758','F10701'];
begin
  select id, nombre into v_ale, v_nombre from public.profiles
   where lower(translate(nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) like '%alejandra%rangel%' and activo
   order by (rol = 'vendedor') desc limit 1;
  if v_ale is null then raise exception 'No encontre el usuario de Alejandra Rangel.'; end if;

  select count(*) into n from public.conciliacion_movimientos where monto = 432832.84;
  if n = 0 then raise exception 'No encontre el abono de $432,832.84. Revisa que ya se haya subido el estado de cuenta.'; end if;
  if n > 1 then raise exception 'Hay % abonos de $432,832.84: avisame para elegir el correcto.', n; end if;
  select id into v_mov from public.conciliacion_movimientos where monto = 432832.84;

  if not (select previo from public.conciliacion_movimientos where id = v_mov) then
    n := public.conciliacion_previo_aplicar(v_mov, v_folios,
      'Pago Pegatron del 19/nov: 33 facturas identificadas a mano antes del portal (recibido en fisico).', v_nombre, null);
    raise notice 'Abono marcado como identificado antes del portal con % facturas.', n;
  end if;

  perform set_config('esc.previo', 'on', true);
  update public.conciliacion_movimientos set vendedor_id = v_ale, tomado_para = v_nombre where id = v_mov;
  update public.conciliacion_facturas set vendedor_id = v_ale where movimiento_id = v_mov;
  perform set_config('esc.previo', 'off', true);
  raise notice 'Listo: asignado a %. Ya le sale en Conciliaciones, "Los mios".', v_nombre;
end $$;
