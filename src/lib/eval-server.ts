import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvalPeriodo } from "@/lib/evaluaciones";

/** Periodos de un tipo: activo, programado y el elegido (por defecto el activo o el ultimo cerrado). */
export async function loadPeriodos(supabase: SupabaseClient, tipo: "proveedores" | "clientes", elegido?: string) {
  const { data } = await supabase.from("eval_periodos").select("id, tipo, nombre, estado, programado_para, activado_at, cerrado_at, cierra_el").eq("tipo", tipo).order("created_at", { ascending: false });
  const all = (data ?? []) as EvalPeriodo[];
  const activo = all.find((p) => p.estado === "activo") ?? null;
  const programado = all.find((p) => p.estado === "programado") ?? null;
  const historial = all.filter((p) => p.estado !== "programado");
  const actual = historial.find((p) => p.id === elegido) ?? activo ?? historial[0] ?? null;
  return { activo, programado, historial, actual };
}

export const fechaLarga = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "");
