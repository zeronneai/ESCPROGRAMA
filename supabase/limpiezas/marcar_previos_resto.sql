-- =============================================================================
-- marcar_previos_resto.sql   (requiere 0087 y 0088; de una sola vez)
-- Deja pendientes SOLO los abonos de la lista de abajo (los que de verdad faltan por identificar) y marca
-- TODOS los demas abonos sin identificar como "Identificado antes del portal", sin vendedor.
--  * Los que ya identifico un vendedor no se tocan.
--  * Un abono de la lista se reconoce por su monto y su fecha (con 3 dias de tolerancia); si hay dos
--    iguales, se quedan los dos pendientes.
--  * Se puede deshacer uno por uno en Conciliaciones con "Deshacer".
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run. Al final dice que hizo.
-- =============================================================================
do $$
declare
  r record;
  n int := 0;
  v_falta text := '';
begin
  create temp table pendientes_reales (fecha date, monto numeric, nota text) on commit drop;
  insert into pendientes_reales values
    -- Lista del estado de cuenta
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
    ('2026-11-26', 18374.40, 'Bancomer 64 HOSSER F-5813, 5800');

  -- Avisa cuales de la lista no encontre en los estados de cuenta subidos.
  for r in select p.* from pendientes_reales p
            where not exists (select 1 from public.conciliacion_movimientos m where m.monto = p.monto and abs(m.fecha - p.fecha) <= 3) loop
    v_falta := v_falta || format(E'\n  %s  $%s  %s', r.fecha, r.monto, r.nota);
  end loop;
  if v_falta <> '' then raise notice 'Estos de tu lista NO estan en los estados de cuenta subidos (revisa): %', v_falta; end if;

  -- Todos los demas sin identificar: identificados antes del portal, sin vendedor.
  for r in
    select m.id from public.conciliacion_movimientos m
     where m.tomado_por is null and not m.previo
       and not exists (select 1 from pendientes_reales p where p.monto = m.monto and abs(m.fecha - p.fecha) <= 3)
  loop
    perform public.conciliacion_previo_aplicar(r.id, '{}', 'Identificado antes del portal (limpieza del 26 de noviembre)', null, null);
    n := n + 1;
  end loop;

  raise notice 'Listo: % abono(s) marcados como identificados antes del portal. Quedan pendientes: % (los de tu lista que si estan subidos).',
    n, (select count(*) from public.conciliacion_movimientos where tomado_por is null and not previo);
end $$;
