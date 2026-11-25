/** Metas mensuales de venta por vendedor. */
export interface AvanceMeta {
  id: string;
  nombre: string;
  vendedor_id: string | null;
  meta: number | null;
  vendido: number | null;
  pct: number;
  ventas: number;
  usd_sin_tc: number;
  mes: string;
  dia: number;
  dias_mes: number;
  es_mio: boolean;
  equipo_pct: number | null;
  /** Este usuario captura a mano las ventas de esta meta. */
  capturo?: boolean;
  /** Meta del mes completo (meta = la proporcional al periodo). */
  meta_mes?: number | null;
  /** Periodo que se mide (desde = mes es el inicio; dia/dias_mes son dias del periodo). */
  desde?: string | null;
  hasta?: string | null;
}

/** Que tanto del mes ya paso (para comparar el avance contra el ritmo esperado). */
export const ritmoDe = (dia: number, diasMes: number) => (diasMes ? Math.round((dia / diasMes) * 1000) / 10 : 0);

/** verde = va al ritmo o arriba; ambar = cerca (>= 75% del ritmo); rojo = atrasado. */
export function colorAvance(pct: number, ritmo: number): "verde" | "ambar" | "rojo" {
  if (pct >= ritmo || pct >= 100) return "verde";
  if (pct >= ritmo * 0.75) return "ambar";
  return "rojo";
}

export const normalizarAvance = (rows: Record<string, unknown>[]): AvanceMeta[] =>
  rows.map((r) => ({
    ...(r as unknown as AvanceMeta),
    meta: r.meta == null ? null : Number(r.meta),
    meta_mes: r.meta_mes == null ? null : Number(r.meta_mes),
    vendido: r.vendido == null ? null : Number(r.vendido),
    pct: Number(r.pct ?? 0),
    equipo_pct: r.equipo_pct == null ? null : Number(r.equipo_pct),
  }));
