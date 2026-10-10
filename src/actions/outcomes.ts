"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { parseNumber } from "@/lib/validation/request";
import type { Result } from "./requests";

const outcomeSchema = z
  .object({
    resultado: z.enum(["sin_respuesta", "ganada", "perdida"]),
    motivo: z.enum(["precio_alto", "tiempo_entrega", "compra_minima", "otro_proveedor", "proyecto_cancelado", "otro"]).optional(),
    motivo_texto: z.string().trim().max(300).optional(),
    cantidad_final: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.resultado === "perdida" && !v.motivo) ctx.addIssue({ code: "custom", path: ["motivo"], message: "Elige el motivo de la pérdida" });
    if (v.resultado === "perdida" && v.motivo === "otro" && !v.motivo_texto) {
      ctx.addIssue({ code: "custom", path: ["motivo_texto"], message: "Describe el motivo" });
    }
    if (v.resultado === "ganada" && v.cantidad_final) {
      const n = parseNumber(v.cantidad_final);
      if (n === undefined || Number.isNaN(n) || n <= 0) ctx.addIssue({ code: "custom", path: ["cantidad_final"], message: "Cantidad final inválida" });
    }
  });
export type OutcomeInput = z.infer<typeof outcomeSchema>;

/** Vendedor: marca o corrige el resultado (cada cambio queda en la bitacora). */
export async function setOutcomeAction(itemId: string, input: OutcomeInput): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "vendedor") return { ok: false, error: "No autorizado" };
  if (!z.string().uuid().safeParse(itemId).success) return { ok: false, error: "Partida invalida" };
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_outcome", {
    p_item: itemId,
    p_resultado: v.resultado,
    p_motivo: v.resultado === "perdida" ? v.motivo : null,
    p_motivo_texto: v.resultado === "perdida" ? v.motivo_texto || null : null,
    p_cantidad_final: v.resultado === "ganada" && v.cantidad_final ? parseNumber(v.cantidad_final) : null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor");
  return { ok: true };
}
