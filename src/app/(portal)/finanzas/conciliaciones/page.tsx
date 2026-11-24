import Link from "next/link";
import { SubirConciliacion } from "@/components/finanzas/subir-conciliacion";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";
import { money2 } from "@/lib/ventas";

const fecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Conciliaciones (finanzas): subir estados de cuenta y ver que abonos ya identificaron los vendedores. */
export default async function Conciliaciones() {
  const u = await requireRoles(["aux_finanzas", "supervisor_finanzas", "jefe_ventas"]);
  const supabase = await createClient();
  const [{ data: concs, error }, { data: movs }] = await Promise.all([
    supabase.from("conciliaciones").select("id, banco, cuenta, moneda, desde, hasta, abonos, nuevos, nombre_archivo, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("conciliacion_movimientos").select("conciliacion_id, moneda, monto, tomado_por").limit(20000),
  ]);
  const por = new Map<string, { total: number; tomados: number; libres: number; libreMonto: number }>();
  for (const m of movs ?? []) {
    const x = por.get(m.conciliacion_id as string) ?? { total: 0, tomados: 0, libres: 0, libreMonto: 0 };
    x.total += 1;
    if (m.tomado_por) x.tomados += 1;
    else { x.libres += 1; x.libreMonto += Number(m.monto); }
    por.set(m.conciliacion_id as string, x);
  }
  const finanzas = u.rol !== "jefe_ventas";
  return (
    <div className="space-y-5">
      <PageHeader title="Conciliaciones" subtitle="Sube el estado de cuenta: los vendedores identifican sus pagos y sus facturas quedan pagadas con la fecha del abono." />
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">Falta correr la actualización 0076 en la base.</Card>}
      {finanzas && !error && <SubirConciliacion />}
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Estados de cuenta subidos</h2>
        <Card className="divide-y divide-slate-100 p-0">
          {(concs ?? []).map((c) => {
            const x = por.get(c.id as string) ?? { total: 0, tomados: 0, libres: 0, libreMonto: 0 };
            return (
              <Link key={c.id} href={`/finanzas/conciliaciones/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                <span>
                  <span className="font-semibold text-slate-900">{c.banco} {c.cuenta ? `···${String(c.cuenta).slice(-4)}` : ""}</span>
                  {c.moneda === "USD" && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">USD</span>}
                  <span className="block text-xs text-slate-500">
                    {fecha(c.desde as string)} al {fecha(c.hasta as string)} · subido {new Date(c.created_at as string).toLocaleDateString("es-MX", { day: "numeric", month: "short" })} · {c.nuevos} nuevo(s) de {c.abonos}
                  </span>
                </span>
                <span className="text-right text-sm">
                  <span className="block font-semibold text-slate-900">{x.tomados} de {x.total} identificados</span>
                  {x.libres > 0 && <span className="text-xs text-amber-800">{x.libres} sin identificar · {money2(x.libreMonto, c.moneda as string)}</span>}
                </span>
              </Link>
            );
          })}
          {!error && (concs ?? []).length === 0 && <p className="px-4 py-6 text-sm text-slate-500">Todavía no se sube ningún estado de cuenta.</p>}
        </Card>
      </section>
    </div>
  );
}
