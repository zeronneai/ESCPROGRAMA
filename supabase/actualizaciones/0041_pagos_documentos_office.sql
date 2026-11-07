-- =============================================================================
-- 0041_pagos_documentos_office.sql   (requiere 0031 ya aplicado)
-- Pagos a proveedores: ademas de PDF e imagen, se pueden adjuntar proformas y facturas en
-- Excel (.xlsx / .xls) y Word (.docx / .doc), como las mandan los proveedores.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'
   ]
 where id = 'pagos';

-- VERIFICACION:
--   select allowed_mime_types from storage.buckets where id = 'pagos';   -- 8 tipos
