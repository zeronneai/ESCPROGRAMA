-- =============================================================================
-- diagnostico_vendedor_factura.sql  (solo lee, no cambia nada)
-- Para ver que nombre de vendedor leyo el portal de las facturas. Pegalo en SQL Editor y dale Run.
-- Salen 4 resultados (cambia entre ellos abajo, en "Results").
-- =============================================================================

-- 1) Periodo que esta midiendo la grafica de metas
select ini as periodo_desde, fin as periodo_hasta from public.metas_periodo();

-- 2) Todos los nombres de vendedor que el portal leyo de las facturas (desde siempre) y cuantas
select coalesce(v.vendedor_factura, '(sin leer)') as vendedor_en_factura, count(*) as facturas,
       min(v.fecha) as primera, max(v.fecha) as ultima
  from public.ventas v
 where v.cancelada_at is null and (v.factura_path is not null or v.xml_path is not null)
 group by 1 order by 2 desc;

-- 3) Cualquier factura (de cualquier fecha) donde el vendedor se parezca a Ivan Munoz
select v.factura, v.fecha, p.nombre as subio, v.vendedor_factura, v.subtotal,
       v.factura_path is not null as tiene_pdf, v.xml_path is not null as tiene_xml
  from public.ventas v left join public.profiles p on p.id = v.vendedor_id
 where v.cancelada_at is null
   and (public.nombre_norm(v.vendedor_factura) like '%IVAN%' or public.nombre_norm(v.vendedor_factura) like '%MUNOZ%')
 order by v.fecha desc;

-- 4) Facturas del periodo sin vendedor leido: con PDF (se pueden leer) y solo XML (el XML no trae vendedor)
select count(*) filter (where v.factura_path is not null) as sin_leer_con_pdf,
       count(*) filter (where v.factura_path is null and v.xml_path is not null) as solo_xml_sin_vendedor
  from public.ventas v cross join lateral public.metas_periodo() per
 where v.cancelada_at is null and v.fecha between per.ini and per.fin and v.vendedor_factura is null;
