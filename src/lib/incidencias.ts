/** Bitacora de incidencias (formato ESC-ALM-FR-003): catalogo del formato. */
export const INCIDENCIA_TIPOS = {
  devolucion: { n: 1, label: "Devolución", desc: "Producto que el cliente devuelve porque no cumple con las características solicitadas." },
  error_carga: { n: 2, label: "Error de carga", desc: "El producto entregado no coincide con el producto facturado." },
  error_factura: { n: 3, label: "Error de factura", desc: "El producto facturado no coincide con el producto solicitado por el cliente." },
  incumplimiento_entrega: { n: 4, label: "Incumplimiento de entrega", desc: "El producto no se entrega en las fechas compromiso y/o en horarios establecidos." },
  producto_no_conforme: { n: 5, label: "Producto no conforme / dañado", desc: "Producto dañado en: reciba, almacenamiento o entrega a cliente." },
} as const;
export type IncidenciaTipo = keyof typeof INCIDENCIA_TIPOS;

export const INCIDENCIA_VARIANTES = { reciba: "Reciba", almacenamiento: "Almacenamiento", entrega_cliente: "Entrega a cliente" } as const;
export type IncidenciaVariante = keyof typeof INCIDENCIA_VARIANTES;

export const INCIDENCIA_CODIGO = "ESC-ALM-FR-003";
export const INCIDENCIAS_LECTORES = ["supervisor_almacen", "jefe_ventas", "gerente", "ceo", "coordinador_iso", "comprador"] as const;

export interface Incidencia {
  id: string;
  folio: string;
  fecha: string;
  tipo: IncidenciaTipo;
  variante: IncidenciaVariante | null;
  producto: string | null;
  cliente: string | null;
  factura: string | null;
  accion: string | null;
  firma_nombre: string | null;
  cancelada_at: string | null;
  created_at: string;
}

export interface AlertaIncidencia {
  id: string;
  tipo: IncidenciaTipo;
  mes: string;
  n: number;
  sac_id: string | null;
}

export const tipoTxt = (t: IncidenciaTipo, v?: IncidenciaVariante | null) => `${INCIDENCIA_TIPOS[t].n}. ${INCIDENCIA_TIPOS[t].label}${v ? ` (${INCIDENCIA_VARIANTES[v]})` : ""}`;
