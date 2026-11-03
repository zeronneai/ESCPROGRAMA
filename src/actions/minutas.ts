"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { MINUTA_CREATORS } from "@/lib/ops/roles";
import { minutaSchema, type MinutaInput } from "@/lib/minutas";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const uuid = z.string().uuid();

/** Guardar la minuta (borrador) y quien la debe firmar. */
export async function saveMinutaAction(id: string | null, input: MinutaInput, firmantes: string[]): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (!MINUTA_CREATORS.includes(u.rol)) return { ok: false, error: "Las minutas las hacen los jefes de departamento." };
  const parsed = minutaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const ids = z.array(uuid).max(60).safeParse(firmantes);
  if (!ids.success) return { ok: false, error: "Firmantes inválidos" };
  const supabase = await createClient();
  let minutaId = id;
  if (id) {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Minuta inválida" };
    const { data, error } = await supabase.from("minutas").update(parsed.data).eq("id", id).select("id");
    if (error) return { ok: false, error: friendlyError(error.message) };
    if (!data?.length) return { ok: false, error: "Ya no puedes editar esta minuta." };
  } else {
    const { data, error } = await supabase.from("minutas").insert(parsed.data).select("id").single();
    if (error) return { ok: false, error: friendlyError(error.message) };
    minutaId = data.id;
  }
  const { error } = await supabase.rpc("minuta_firmantes", { p_id: minutaId, p_users: ids.data });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/minutas");
  revalidatePath(`/minutas/${minutaId}`);
  return { ok: true, id: minutaId! };
}

/** Enviar a firmas: avisa a cada firmante. Ya no se puede editar. */
export async function enviarMinutaAction(id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Minuta inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("minuta_enviar", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/minutas");
  revalidatePath(`/minutas/${id}`);
  return { ok: true };
}

export async function firmarMinutaAction(id: string): Promise<Result> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Minuta inválida" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("minuta_firmar", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/minutas");
  revalidatePath(`/minutas/${id}`);
  return { ok: true };
}
