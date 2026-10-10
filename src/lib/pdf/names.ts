/**
 * "Nombre en el PDF" de una partida. La descripcion y el uso del producto son INTERNOS: nunca se usan aqui.
 * Prioridad: nombre editado por el vendedor (version vigente) > alternativo cotizado por el comprador > producto solicitado.
 */
export const PDF_NAME_MAX = 200;

export function defaultPdfName(altNombre: string | null | undefined, producto: string): string {
  return altNombre?.trim() || producto.trim();
}

export function resolvePdfName(saved: string | null | undefined, altNombre: string | null | undefined, producto: string): string {
  return saved?.trim() || defaultPdfName(altNombre, producto);
}
