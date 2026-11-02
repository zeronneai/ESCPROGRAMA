"use server";

import { revalidatePath } from "next/cache";
import { requireBuyer } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const SECCIONES = ["todo", "clientes", "cotizaciones", "bitacora", "calidad", "consumo", "guias"] as const;

/** Carga datos de demostracion (solo comprador). La base reparte todo entre los usuarios reales. */
export async function demoCargarAction(seccion: string): Promise<Result<{ detalle: string }>> {
  await requireBuyer();
  if (!(SECCIONES as readonly string[]).includes(seccion)) return { ok: false, error: "Sección inválida" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("demo_cargar", { p_seccion: seccion });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, detalle: String(data ?? "") };
}
