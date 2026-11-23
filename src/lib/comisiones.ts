export interface ComLinea {
  id: string;
  clave: string | null;
  descripcion: string;
  cantidad: number | null;
  importe: number | null;
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
