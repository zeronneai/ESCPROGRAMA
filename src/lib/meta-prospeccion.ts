/** Meta diaria de prospeccion (lunes a viernes, acumulativa desde la fecha de inicio). */
export type TipoProspeccion = "telemarketing" | "campo" | "sin_meta";
export const TIPOS_PROSPECCION: Record<TipoProspeccion, string> = { telemarketing: "Telemarketing", campo: "Campo", sin_meta: "Sin meta" };

export interface AvanceProspeccion {
  vendedor_id: string;
  nombre: string;
  tipo: TipoProspeccion;
  meta_diaria: number;
  inicio: string;
  dias: number;
  requeridos: number;
  registrados: number;
  faltan: number;
  hoy: number;
  meta_hoy: number;
  /** De los registrados desde el inicio, cuantos ya se hicieron clientes (0085). */
  convertidos?: number;
}
