export interface ComLinea {
  id: string;
  clave: string | null;
  descripcion: string;
  cantidad: number | null;
  importe: number | null;
  envio: number | null;
  pct: number | null;
  comision: number | null;
}
export interface ComFactura {
  id: string;
  factura: string | null;
  cliente: string;
  fecha: string;
  fecha_cobro: string | null;
  moneda: string;
  monto: number | null;
  pagada: boolean;
  revisada: boolean;
  lineas: ComLinea[];
  comision: number;
  faltan: number;
}
export interface ComVendedor {
  id: string;
  nombre: string;
  facturas: ComFactura[];
}

/** Quien ve la pantalla: el vendedor (las suyas, las llena), la jefa (todas, corrige y revisa) o la gerente (solo revisadas, solo totales). */
export type ModoComisiones = "vendedor" | "jefa" | "gerente";

/** Renglon de la venta guardado y renglon leido de la factura, para volver a sacar el importe. */
export type RenglonVenta = { id: string; clave: string | null; descripcion: string; cantidad: number | null };
export type RenglonLeido = { clave: string | null; descripcion: string; cantidad: number | null; importe?: number | null };

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const mismaCant = (a: number | null, b: number | null) => a == null || b == null || Math.abs(Math.ceil(b) - a) < 0.01 || Math.abs(a - b) < 0.01;

/**
 * Empareja los articulos guardados de una venta con los renglones leidos de su factura y regresa el
 * importe de cada uno (solo los que se pudieron emparejar con seguridad).
 * 1) Mismo numero de renglones y todos cuadran en orden (clave o descripcion, y cantidad): por orden.
 * 2) Si no: por clave + cantidad, y luego por descripcion + cantidad.
 */
export function emparejarImportes(guardados: RenglonVenta[], leidos: RenglonLeido[]): Map<string, number> {
  const out = new Map<string, number>();
  const conImporte = leidos.filter((l) => l.importe != null && Number.isFinite(l.importe));
  const parecido = (g: RenglonVenta, l: RenglonLeido) =>
    mismaCant(g.cantidad, l.cantidad) &&
    ((!!g.clave && norm(g.clave) === norm(l.clave)) || (!!norm(g.descripcion) && (norm(l.descripcion).startsWith(norm(g.descripcion).slice(0, 40)) || norm(g.descripcion).startsWith(norm(l.descripcion).slice(0, 40)) || norm(g.descripcion) === norm(l.clave))));
  if (guardados.length === leidos.length && guardados.every((g, i) => parecido(g, leidos[i]) && leidos[i].importe != null)) {
    guardados.forEach((g, i) => out.set(g.id, Number(leidos[i].importe)));
    return out;
  }
  const usados = new Set<number>();
  for (const pasada of ["clave", "desc"] as const) {
    for (const g of guardados) {
      if (out.has(g.id)) continue;
      const j = conImporte.findIndex((l, k) => !usados.has(k) && mismaCant(g.cantidad, l.cantidad) && (pasada === "clave" ? !!g.clave && norm(g.clave) === norm(l.clave) : parecido(g, l)));
      if (j >= 0) {
        usados.add(j);
        out.set(g.id, Number(conImporte[j].importe));
      }
    }
  }
  return out;
}
