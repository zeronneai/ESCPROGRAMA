import { SuppliersPanel } from "@/components/eval/suppliers-panel";
import { requireBuyer } from "@/lib/auth/guards";
import { SUPPLIER_COLS, type SupplierRow } from "@/lib/evaluaciones";
import { createClient } from "@/lib/supabase/server";

/** Proveedores: alta con datos y quien entra a la evaluacion (solo comprador). */
export default async function Proveedores() {
  await requireBuyer();
  const supabase = await createClient();
  const [{ data: sup }, { data: costs }, { data: evals }] = await Promise.all([
    supabase.from("suppliers").select(SUPPLIER_COLS).order("nombre"),
    supabase.from("item_costs").select("proveedor").not("proveedor", "is", null).limit(20000),
    supabase.from("eval_proveedor").select("supplier_id, puntaje, eval_periodos(nombre, created_at)").not("puntaje", "is", null).limit(5000),
  ]);
  const cot: Record<string, number> = {};
  for (const c of costs ?? []) {
    const k = String(c.proveedor).trim().toLowerCase();
    cot[k] = (cot[k] ?? 0) + 1;
  }
  const scores: Record<string, { puntaje: number | null; periodo: string; at: string }> = {};
  for (const e of (evals ?? []) as unknown as { supplier_id: string; puntaje: number; eval_periodos: { nombre: string; created_at: string } | null }[]) {
    const at = e.eval_periodos?.created_at ?? "";
    if (!scores[e.supplier_id] || scores[e.supplier_id].at < at) scores[e.supplier_id] = { puntaje: Number(e.puntaje), periodo: e.eval_periodos?.nombre ?? "", at };
  }
  return <SuppliersPanel suppliers={(sup ?? []) as SupplierRow[]} scores={scores} cotizaciones={cot} />;
}
