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
  lineas: ComLinea[];
  comision: number;
  faltan: number;
}
export interface ComVendedor {
  id: string;
  nombre: string;
  facturas: ComFactura[];
}
