/** Pedidos de vendedores al comprador. */
export type Frecuencia = "unica" | "semanal" | "mensual" | "anual";
export type EstadoPedido = "activo" | "pedido" | "cancelado";

export const FRECUENCIAS: Record<Frecuencia, string> = {
  unica: "Una sola vez (pedido especial)",
  semanal: "Cada semana",
  mensual: "Cada mes",
  anual: "Cada año",
};
export const FRECUENCIA_CORTA: Record<Frecuencia, string> = { unica: "Única", semanal: "Semanal", mensual: "Mensual", anual: "Anual" };

/** Lo que un pedido recurrente suma a la demanda de cada mes (unica no suma: se aparta una vez). */
export function mensualDe(frecuencia: Frecuencia, cantidad: number): number {
  if (frecuencia === "semanal") return (cantidad * 52) / 12;
  if (frecuencia === "mensual") return cantidad;
  if (frecuencia === "anual") return cantidad / 12;
  return 0;
}

export interface PedidoPlan {
  id: string;
  vendedor: string;
  cantidad: number;
  frecuencia: Frecuencia;
  cliente: string | null;
  notas: string | null;
  created_at: string;
}

/** Resumen por articulo: unidades unicas por apartar y demanda mensual extra. */
export function resumenPedidos(ps: PedidoPlan[]) {
  let unica = 0;
  let mensual = 0;
  for (const p of ps) {
    if (p.frecuencia === "unica") unica += p.cantidad;
    else mensual += mensualDe(p.frecuencia, p.cantidad);
  }
  return { unica, mensual };
}
