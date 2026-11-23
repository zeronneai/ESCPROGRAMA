"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const pagoSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Falta la fecha de un pago"),
  monto: z.coerce.number().positive("Falta el monto de un pago"),
  moneda: z.enum(["MXN", "USD"]).default("MXN"),
  forma: z.enum(["transferencia", "deposito", "cheque", "efectivo", "otro"]).default("transferencia"),
  referencia: z.string().max(120).optional().default(""),
  ventas: z.array(z.string().uuid()).min(1, "Cada pago debe cubrir al menos una factura"),
});
const entregaSchema = z.object({ notas: z.string().max(1000).optional().default(""), pagos: z.array(pagoSchema).min(1, "Agrega al menos un pago") });

const falta = (m: string) => /facturas_entregar|factura_revisar|factura_entrega_nota|does not exist/.test(m);

function revalidar(vendedor?: string) {
  revalidatePath("/vendedor/recepcion-facturas");
  revalidatePath("/finanzas/recepcion", "layout");
  if (vendedor) revalidatePath(`/finanzas/recepcion/${vendedor}`);
  revalidatePath("/inicio");
}

/** El vendedor entrega sus facturas cobradas a finanzas, agrupadas por el pago con que se cobraron. */
export async function entregarFacturasAction(input: unknown): Promise<Result<{ id: string }>> {
  await requireUser();
  const p = entregaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("facturas_entregar", { p: p.data });
  if (error) return { ok: false, error: falta(error.message) ? "Falta correr la actualización 0070 en la base." : friendlyError(error.message) };
  revalidar();
  return { ok: true, id: data as string };
}

/** Finanzas: recibida, rechazada (con motivo) o regresarla a por revisar. */
export async function revisarFacturaAction(id: string, estado: "por_revisar" | "recibida" | "rechazada", motivo?: string): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Factura inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("factura_revisar", { p_id: id, p_estado: estado, p_motivo: (motivo ?? "").slice(0, 500) || null });
  if (error) return { ok: false, error: falta(error.message) ? "Falta correr la actualización 0070 en la base." : friendlyError(error.message) };
  revalidar();
  return { ok: true };
}

/** Anotacion en una entrega (finanzas o el vendedor). */
export async function notaEntregaAction(entregaId: string, texto: string): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(entregaId).success) return { ok: false, error: "Entrega inválida" };
  if (!texto.trim()) return { ok: false, error: "Escribe la anotación" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("factura_entrega_nota", { p_entrega: entregaId, p_texto: texto.slice(0, 1000) });
  if (error) return { ok: false, error: falta(error.message) ? "Falta correr la actualización 0070 en la base." : friendlyError(error.message) };
  revalidar();
  return { ok: true };
}
