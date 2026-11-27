"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { INCIDENCIA_TIPOS, INCIDENCIA_VARIANTES } from "@/lib/incidencias";
import type { Result } from "./requests";

const msg = (m: string) => (/incidencia/.test(m) && /exist|does not|could not find/i.test(m) ? "Falta correr la actualización 0095 en Supabase." : friendlyError(m));

const incidencia = z
  .object({
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    tipo: z.enum(Object.keys(INCIDENCIA_TIPOS) as [keyof typeof INCIDENCIA_TIPOS, ...(keyof typeof INCIDENCIA_TIPOS)[]], { message: "Elige la incidencia" }),
    variante: z.enum(Object.keys(INCIDENCIA_VARIANTES) as [keyof typeof INCIDENCIA_VARIANTES, ...(keyof typeof INCIDENCIA_VARIANTES)[]]).nullable(),
    producto: z.string().trim().max(500).nullable(),
    cliente: z.string().trim().max(300).nullable(),
    factura: z.string().trim().max(80).nullable(),
    accion: z.string().trim().max(2000).nullable(),
  })
  .strict()
  .refine((v) => v.tipo !== "producto_no_conforme" || !!v.variante, { message: "Elige dónde se dañó: reciba, almacenamiento o entrega a cliente." });

/** El supervisor de almacen registra (o corrige) una incidencia. */
export async function guardarIncidenciaAction(id: string | null, input: z.input<typeof incidencia>): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (u.rol !== "supervisor_almacen") return { ok: false, error: "Solo el supervisor de almacén llena la bitácora." };
  const p = incidencia.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const row = { ...p.data, variante: p.data.tipo === "producto_no_conforme" ? p.data.variante : null, producto: p.data.producto || null, cliente: p.data.cliente || null, factura: p.data.factura || null, accion: p.data.accion || null };
  const supabase = await createClient();
  if (id) {
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Incidencia inválida" };
    const { error } = await supabase.from("incidencias").update(row).eq("id", id);
    if (error) return { ok: false, error: msg(error.message) };
    revalidatePath("/incidencias");
    return { ok: true, id };
  }
  const { data, error } = await supabase.from("incidencias").insert(row).select("id").single();
  if (error) return { ok: false, error: msg(error.message) };
  revalidatePath("/incidencias");
  return { ok: true, id: data.id };
}

export async function cancelarIncidenciaAction(id: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "supervisor_almacen") return { ok: false, error: "Solo el supervisor de almacén." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Incidencia inválida" };
  const supabase = await createClient();
  const { error } = await supabase.from("incidencias").update({ cancelada_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: msg(error.message) };
  revalidatePath("/incidencias");
  return { ok: true };
}
