-- =============================================================================
-- marcar_previos_final.sql   (requiere 0087, 0088 y 0089; de una sola vez)
-- Deja como estan SOLO los abonos de la lista de abajo (los que de verdad faltan por identificar) y pasa
-- TODOS los demas a "Identificado antes del portal":
--  * Si nadie lo habia identificado: queda sin vendedor.
--  * Si un vendedor ya lo habia identificado: se queda a su nombre con sus facturas.
--  * Sus facturas salen de la bandeja de la auxiliar de finanzas (quedan recibidas) y al vendedor no le
--    salen para entregar.
-- Un abono de la lista se reconoce por monto y fecha (3 dias de tolerancia); los 5 de la ultima lista, que
-- no traen fecha, solo por monto. Si hay varios iguales, se quedan todos.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que hizo.
-- =============================================================================
do $$
declare
  r record;
  n int := 0;
  f int := 0;
  v_falta text := '';
begin
  create temp table pendientes_reales (fecha date, monto numeric, nota text) on commit drop;
  insert into pendientes_reales values
    -- Estado de cuenta
    ('2026-11-26', 5407.77, 'Ventas debito terminal'),
    ('2026-11-26', 2737.60, 'Ventas credito terminal'),
    ('2026-11-25', 3990.40, 'Pago tercero Guantes'),
    ('2026-11-25', 15312.00, 'SPEI Santander F11528'),
    ('2026-11-25', 112893.32, 'SPEI HSBC PAYMENT ESC'),
    ('2026-11-25', 47049.60, 'SPEI Santander del valle a esc'),
    ('2026-11-25', 9233.60, 'SPEI Santander Pinturas Lacey PMC169'),
    ('2026-11-25', 8969.38, 'Pago tercero OC12272'),
    ('2026-11-25', 3828.00, 'Deposito tercero BMRCASH'),
    ('2026-11-24', 904.80, 'SPEI Santander Dra Denisse Pacheco'),
    ('2026-11-24', 12853.96, 'Pago tercero FACT PMC162'),
    ('2026-11-24', 1473.20, 'SPEI Banamex F11522'),
    ('2026-11-24', 2179.64, 'SPEI HSBC BA023MX1'),
    ('2026-11-24', 2302.60, 'Ventas debito terminal'),
    ('2026-11-23', 3224.80, 'SPEI Banorte'),
    ('2026-11-23', 870.00, 'Pago tercero Guantes'),
    ('2026-11-23', 5962.40, 'SPEI Mifel PMC146'),
    ('2026-11-23', 483.72, 'SPEI Banorte F10425'),
    ('2026-11-23', 6588.17, 'SPEI Santander F10854 F10958'),
    ('2026-11-23', 1740.00, 'SPEI Bajio Guantes'),
    ('2026-11-21', 414.10, 'Pago tercero F11488'),
    ('2026-11-13', 28392.16, 'Deposito tercero BMRCASH'),
    ('2026-11-13', 664290.12, 'Pago tercero Fact 11239'),
    -- Hoja de Jose Luis Amaya Estrada
    ('2026-11-25', 51873.34, 'Santander F-5707'),
    ('2026-11-24', 24960.07, 'Bancomer 41 PMC97'),
    ('2026-11-24', 7053.96, 'Bancomer 41 PMC82'),
    ('2026-11-25', 82597.10, 'Bancomer 41 PMC95'),
    ('2026-11-25', 4703.80, 'Bancomer 41 PMC105'),
    ('2026-11-25', 27530.28, 'Bancomer 64 F-5629'),
    ('2026-11-26', 27561.60, 'Bancomer 64 HOSSER F-5750'),
    ('2026-11-26', 18374.40, 'Bancomer 64 HOSSER F-5813, 5800'),
    -- Ultima lista (sin fecha: solo por monto)
    (null, 23582.80, 'Sin fecha'),
    (null, 8121.74, 'Sin fecha'),
    (null, 3132.00, 'Sin fecha'),
    (null, 31324.64, 'Sin fecha'),
    (null, 104629.68, 'Sin fecha');

  for r in select p.* from pendientes_reales p
            where not exists (select 1 from public.conciliacion_movimientos m
                               where m.monto = p.monto and (p.fecha is null or abs(m.fecha - p.fecha) <= 3)) loop
    v_falta := v_falta || format(E'\n  %s  $%s  %s', coalesce(r.fecha::text, 'sin fecha'), r.monto, r.nota);
  end loop;
  if v_falta <> '' then raise notice 'Estos de tu lista NO estan en los estados de cuenta subidos (revisa): %', v_falta; end if;

  -- Todos los demas (identificados o no): antes del portal, conservando al vendedor si ya lo tenia.
  for r in
    select m.id from public.conciliacion_movimientos m
     where not m.previo
       and not exists (select 1 from pendientes_reales p where p.monto = m.monto and (p.fecha is null or abs(m.fecha - p.fecha) <= 3))
  loop
    f := f + public.conciliacion_previo_conservar(r.id, 'Identificado antes del portal (limpieza del 26 de noviembre)', null);
    n := n + 1;
  end loop;

  raise notice 'Listo: % abono(s) pasaron a "Identificados antes del portal"; % factura(s) salieron de la bandeja de finanzas (recibidas).', n, f;
  raise notice 'Quedan sin identificar: % (deben ser los de tu lista).', (select count(*) from public.conciliacion_movimientos where tomado_por is null and not previo);
end $$;
