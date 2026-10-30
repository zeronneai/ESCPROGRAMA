/** Columnas para listas de bitacora (con el cliente y el vendedor). */
export const BITACORA_SELECT =
  "*, customers(id, nombre, tipo, giro, estado_geo, contacto_nombre, contacto_telefono), profiles:profiles!bitacora_vendedor_id_fkey(nombre)";
