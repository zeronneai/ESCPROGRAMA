-- =============================================================================
-- revisar_ivan_munoz.sql  (solo lee, no cambia nada)
-- Para ver si las facturas de IVAN MUÑOZ ya solo cuentan para el EQUIPO en las metas.
-- Pegalo en SQL Editor y dale Run. Salen 3 resultados (cambia de pestaña abajo en "Results").
-- =============================================================================

-- 1) ¿Se corrio la 0099? Debe decir: IVAN MUÑOZ
select solo_equipo as nombres_solo_equipo from public.metas_config where id = 1;

-- 2) Facturas del periodo de metas que dicen IVAN MUÑOZ (quien la subio y el subtotal que ya NO le cuenta)
select v.factura, v.fecha, p.nombre as subio, v.vendedor_factura as vendedor_en_factura, v.moneda,
       v.subtotal as subtotal_sin_iva
  from public.ventas v
  left join public.profiles p on p.id = v.vendedor_id
  cross join lateral public.metas_periodo() per
 where v.cancelada_at is null and v.fecha between per.ini and per.fin
   and public.nombre_norm(v.vendedor_factura) like 'IVAN MUNOZ%'
 order by v.fecha;

-- 3) Facturas del periodo a las que todavia NO se les ha leido el vendedor
--    (si salen muchas, dale "Leer datos de las facturas" en el portal y vuelve a correr esto)
select count(*) as facturas_sin_leer_vendedor
  from public.ventas v cross join lateral public.metas_periodo() per
 where v.cancelada_at is null and v.fecha between per.ini and per.fin
   and v.vendedor_factura is null and v.factura_path is not null;
