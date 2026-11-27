/** Cuentas cuyo estado de cuenta se sube diario (lunes a viernes, antes de las 9 am). */
export interface CuentaHoy {
  id: string;
  banco: string;
  cuenta: string;
  nombre: string | null;
  moneda: "MXN" | "USD";
  subido: boolean;
  subido_at: string | null;
  sin_abonos: boolean;
  habil: boolean;
}
export const HORA_LIMITE = 9;
export const cuentaTxt = (c: Pick<CuentaHoy, "banco" | "cuenta" | "nombre" | "moneda">) =>
  `${c.nombre?.trim() || c.banco} ···${c.cuenta.slice(-4)}${c.moneda === "USD" ? " (USD)" : ""}`;
