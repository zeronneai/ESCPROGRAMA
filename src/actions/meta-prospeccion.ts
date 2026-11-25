"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const conf = z.object({
  meta_telemarketing: z.number().int().min(0).max(200),
  meta_campo: z.number().int().min(0).max(200),
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de inicio inválida"),
});

/** La jefa de ventas cambia las metas diarias y la fecha desde la que se cuentan. */
export async function guardarMetaProspeccionAction(input: z.input<typeof conf>): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas cambia la meta." };
  const p = conf.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("prospeccion_config").upsert({ id: 1, ...p.data, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/ventas/meta-prospeccion");
  return { ok: true };
}

/** La jefa de ventas dice si un vendedor es de telemarketing, de campo o sin meta. */
export async function tipoProspeccionAction(vendedorId: string, tipo: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas") return { ok: false, error: "Solo la jefa de ventas cambia el tipo." };
  if (!z.string().uuid().safeParse(vendedorId).success || !["telemarketing", "campo", "sin_meta"].includes(tipo)) return { ok: false, error: "Dato inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("prospeccion_vendedor").upsert({ vendedor_id: vendedorId, tipo, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/ventas/meta-prospeccion");
  return { ok: true };
}
