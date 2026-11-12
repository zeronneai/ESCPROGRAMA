"use server";

import { requireUser } from "@/lib/auth/guards";
import { firmaSchema, type Firma } from "@/lib/firma";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

export async function guardarFirmaAction(input: Firma): Promise<Result> {
  await requireUser();
  const p = firmaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_mi_firma", { p_firma: p.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true };
}

export async function posponerFirmaAction(): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("posponer_mi_firma");
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true };
}
