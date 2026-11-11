"use server";

import { quejaLinkSchema, type QuejaLinkInput } from "@/lib/ops/calidad";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

/** Queja que manda un cliente desde el link publico (sin cuenta). Cae al coordinador ISO como "Por revisar". */
export async function enviarQuejaLinkAction(input: QuejaLinkInput, trampa: string): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  // Campo oculto: solo lo llenan los robots. Se responde como si todo saliera bien.
  if (trampa) return { ok: true, numero: "" };
  const p = quejaLinkSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queja_link_crear", {
    p_cliente: p.data.cliente_nombre, p_contacto: p.data.contacto_nombre, p_medio: p.data.contacto_medio,
    p_referencia: p.data.referencia, p_descripcion: p.data.descripcion,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true, numero: String(data ?? "") };
}
