import { z } from "zod";

export const CATEGORIAS = {
  papeleria: "Papelería",
  limpieza: "Limpieza",
  cafeteria: "Cafetería",
  vehiculo: "Vehículos",
  equipo: "Equipo / herramienta",
  mantenimiento: "Mantenimiento",
  otro: "Otro",
} as const;
export type Categoria = keyof typeof CATEGORIAS;

export const CONSUMO_ESTADOS = {
  por_aprobar: { label: "Por aprobar", chip: "bg-amber-100 text-amber-900" },
  aprobada: { label: "Aprobada", chip: "bg-sky-100 text-sky-900" },
  rechazada: { label: "Rechazada", chip: "bg-red-100 text-red-800" },
  en_proceso: { label: "En proceso", chip: "bg-indigo-100 text-indigo-900" },
  completada: { label: "Completada", chip: "bg-green-100 text-green-800" },
  cancelada: { label: "Cancelada", chip: "bg-slate-200 text-slate-700" },
} as const;
export type ConsumoEstado = keyof typeof CONSUMO_ESTADOS;

/** Texto del avance segun sea producto o servicio. */
export function avanceLabel(tipo: "producto" | "servicio", estado: "en_proceso" | "completada") {
  if (estado === "en_proceso") return tipo === "servicio" ? "Agendado" : "Pedido";
  return tipo === "servicio" ? "Realizado" : "Recibido";
}

export const consumoSchema = z.object({
  tipo: z.enum(["producto", "servicio"]),
  categoria: z.enum(Object.keys(CATEGORIAS) as [Categoria, ...Categoria[]], { message: "Elige la categoría" }),
  descripcion: z.string().trim().min(2, "Escribe qué necesitas").max(500),
  cantidad: z.coerce.number({ message: "Cantidad inválida" }).positive("La cantidad debe ser mayor a 0").max(9999999),
  unidad: z.string().trim().max(40).optional().transform((v) => v || null),
  motivo: z.string().trim().min(3, "Escribe para qué se necesita").max(1000),
  urgente: z.boolean().default(false),
});
export type ConsumoInput = z.input<typeof consumoSchema>;
