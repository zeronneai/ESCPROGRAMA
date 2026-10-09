import { isHttpUrl } from "./request";

export interface SourcingValues {
  proveedor: string;
  link_producto: string;
  contacto: string;
  numero_parte: string;
  notas_compra: string;
}

export const emptySourcingValues: SourcingValues = { proveedor: "", link_producto: "", contacto: "", numero_parte: "", notas_compra: "" };

/** El link del producto, si se captura, debe ser http o https. */
export function validateSourcing(v: SourcingValues): string | null {
  if (v.link_producto.trim() && !isHttpUrl(v.link_producto)) return "El link debe iniciar con http:// o https://";
  return null;
}
