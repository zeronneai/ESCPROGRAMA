export const TIPOS_RECEPCION = {
  compra: "Compra (llegó de proveedor)",
  inventario_inicial: "Inventario inicial (lo que ya hay)",
  devolucion: "Devolución de cliente",
  ajuste: "Ajuste de inventario",
} as const;
export type TipoRecepcion = keyof typeof TIPOS_RECEPCION;

export const ESTADO_SALIDA = {
  por_cargar: { label: "Por cargar", cls: "bg-amber-100 text-amber-900" },
  cargando: { label: "Cargando", cls: "bg-sky-100 text-sky-800" },
  cargada: { label: "Cargada", cls: "bg-green-100 text-green-800" },
  cancelada: { label: "Cancelada", cls: "bg-slate-200 text-slate-700" },
} as const;
export type EstadoSalida = keyof typeof ESTADO_SALIDA;

export const ESTADO_ETIQUETA = {
  almacen: { label: "En almacén", cls: "bg-green-100 text-green-800" },
  cargada: { label: "Salió", cls: "bg-sky-100 text-sky-800" },
  baja: { label: "Baja", cls: "bg-red-100 text-red-800" },
} as const;

export interface RecepcionRow {
  id: string;
  folio: string;
  tipo: TipoRecepcion;
  fecha: string;
  orden_compra: string | null;
  proveedor: string | null;
  notas: string | null;
  autor_nombre: string | null;
  created_at: string;
}
export const RECEPCION_COLS = "id, folio, tipo, fecha, orden_compra, proveedor, notas, autor_nombre, created_at";

export interface SalidaRow {
  id: string;
  folio_factura: string;
  fecha_factura: string | null;
  cliente: string | null;
  vendedor_factura: string | null;
  factura_path: string | null;
  factura_nombre: string | null;
  xml_path: string | null;
  estado: EstadoSalida;
  incompleta: boolean;
  notas: string | null;
  cierre_nota: string | null;
  cargada_at: string | null;
  cargada_nombre: string | null;
  created_by: string;
  autor_nombre: string | null;
  created_at: string;
}
export const SALIDA_COLS =
  "id, folio_factura, fecha_factura, cliente, vendedor_factura, factura_path, factura_nombre, xml_path, estado, incompleta, notas, cierre_nota, cargada_at, cargada_nombre, created_by, autor_nombre, created_at";

export interface SalidaLinea {
  id: string;
  orden: number;
  articulo_id: string | null;
  clave: string | null;
  descripcion: string | null;
  unidad: string | null;
  cantidad: number;
  escaneadas: number;
}

/** Contenido del QR: liga a la ficha de la etiqueta (el escaner y el sistema solo usan el codigo E-000123). */
export const qrEtiqueta = (origin: string, codigo: string) => `${origin.replace(/\/$/, "")}/e/${codigo}`;
export const extraerCodigo = (texto: string) => texto.toUpperCase().match(/E-\d{4,}/)?.[0] ?? null;

/** Puestos */
export const ALMACEN = ["almacen", "supervisor_almacen"] as const;
export const SUBEN_FACTURA = ["vendedor", "jefe_ventas", "marketplaces", "almacen", "supervisor_almacen"] as const;
