"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();
const lineaSchema = z.object({
  item: z.string().trim().max(20).default(""),
  numero_parte: z.string().trim().max(80).default(""),
  descripcion: z.string().trim().min(1, "Falta la descripción de un renglón").max(500),
  cantidad: z.coerce.number({ message: "Cantidad inválida" }).positive("La cantidad debe ser mayor a 0"),
  unidad: z.string().trim().max(20).default(""),
  entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  articulo_esc: z.string().trim().min(2, "Escribe el artículo ESC en cada renglón").max(200),
});
const ocSchema = z.object({
  po_numero: z.string().trim().min(3, "Escribe el número de la orden de compra (P/O)").max(40),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  moneda: z.enum(["USD", "MXN"]).nullable().optional(),
  notas: z.string().trim().max(1000).default(""),
  lineas: z.array(lineaSchema).min(1, "La orden no tiene renglones").max(200),
});
export type OcPegatronInput = z.input<typeof ocSchema>;

const sinTablas = (m: string) => /pegatron_crear|pegatron_oc|pegatron_pedido/.test(m) ? "Primero corre la actualización 0053 en Supabase." : friendlyError(m);

/** La jefa de ventas sube la OC de Pegatron con el articulo ESC de cada renglon. */
export async function crearPedidoPegatronAction(fd: FormData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas sube pedidos de Pegatron." };
  let datos: unknown;
  try {
    datos = JSON.parse(String(fd.get("datos") ?? "{}"));
  } catch {
    return { ok: false, error: "Datos inválidos" };
  }
  const p = ocSchema.safeParse(datos);
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, error: i.path[0] === "lineas" && typeof i.path[1] === "number" ? `Renglón ${i.path[1] + 1}: ${i.message}` : i.message };
  }
  const file = fd.get("file");
  if (file instanceof File && file.size > 10 * 1024 * 1024) return { ok: false, error: "El PDF pesa más de 10 MB" };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("pegatron_crear", { p: p.data });
  if (error || !id) return { ok: false, error: sinTablas(error?.message ?? "No se pudo guardar") };
  if (file instanceof File && file.size > 0) {
    const path = `${id}/${Date.now()}.pdf`;
    const up = await supabase.storage.from("pegatron").upload(path, file, { contentType: "application/pdf" });
    if (!up.error) await supabase.rpc("pegatron_archivo", { p_id: id, p_path: path, p_nombre: file.name.slice(0, 200) });
  }
  revalidatePath("/pedidos-pegatron");
  return { ok: true, id: String(id) };
}

/** ¿Ya se subio esa P/O? */
export async function poPegatronUsadaAction(po: string): Promise<{ id: string; folio: string } | null> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("pegatron_oc").select("id, folio").ilike("po_numero", po.trim()).maybeSingle();
  return (data as { id: string; folio: string } | null) ?? null;
}

/** El comprador marca (o desmarca) que ya pidio el articulo. */
export async function marcarPedidoPegatronAction(lineaId: string, pedido: boolean): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo el comprador marca lo pedido." };
  if (!uuid.safeParse(lineaId).success) return { ok: false, error: "Renglón inválido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pegatron_pedido", { p_linea: lineaId, p_pedido: pedido });
  if (error) return { ok: false, error: sinTablas(error.message) };
  revalidatePath("/pedidos-pegatron", "layout");
  return { ok: true };
}

/** La jefa corrige el articulo ESC de un renglon (mientras no este pedido). */
export async function articuloEscAction(lineaId: string, articulo: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas cambia el artículo ESC." };
  if (!uuid.safeParse(lineaId).success) return { ok: false, error: "Renglón inválido" };
  const a = articulo.trim();
  if (a.length < 2 || a.length > 200) return { ok: false, error: "Escribe el artículo ESC" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("pegatron_oc_lineas").update({ articulo_esc: a }).eq("id", lineaId).select("id");
  if (error) return { ok: false, error: sinTablas(error.message) };
  if (!data?.length) return { ok: false, error: "Ese renglón ya se pidió: ya no se puede cambiar." };
  revalidatePath("/pedidos-pegatron", "layout");
  return { ok: true };
}
