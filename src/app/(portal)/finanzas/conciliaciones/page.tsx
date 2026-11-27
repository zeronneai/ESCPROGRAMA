import Link from "next/link";
import { ListaConciliacion } from "@/components/finanzas/lista-conciliacion";
import { SubirConciliacion } from "@/components/finanzas/subir-conciliacion";
import { CuentasDiarias } from "@/components/finanzas/cuentas-diarias";
import type { CuentaHoy } from "@/lib/estados-cuenta-diarios";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { cargarMovimientos, diasRestantes } from "@/lib/conciliaciones";
import { createClient } from "@/lib/supabase/server";
import { money2 } from "@/lib/ventas";

const fecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Conciliaciones (finanzas): subir estados de cuenta y ver que abonos ya identificaron los vendedores. */
export default async function Conciliaciones() {
  const u = await requireRoles(["aux_finanzas", "supervisor_finanzas", "jefe_ventas", "gerente", "ceo", "comprador"]);
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
  const finanzas = u.rol === "aux_finanzas" || u.rol === "supervisor_finanzas";
  // Todos los abonos (para ver los pendientes y, la direccion, identificarlos a nombre de un vendedor).
  const hoyCtas = finanzas || u.rol === "gerente" || u.rol === "ceo" ? await supabase.rpc("estados_cuenta_hoy") : null;
  const [{ movs: todos }, { data: vends }] = await Promise.all([
    cargarMovimientos(supabase),
    finanzas ? Promise.resolve({ data: [] as { id: string; nombre: string }[] }) : supabase.from("profiles").select("id, nombre").in("rol", ["vendedor", "jefe_ventas"]).eq("activo", true).order("nombre"),
  ]);
  const libres = todos.filter((m) => !m.tomado_por);
  const previos = todos.filter((m) => m.previo).length;
  const vencidos = libres.filter((m) => diasRestantes(m.created_at) <= 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Conciliaciones" subtitle="Sube el estado de cuenta: los vendedores identifican sus pagos y sus facturas quedan pagadas con la fecha del abono." />
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">Falta correr la actualización 0076 en la base.</Card>}
      {hoyCtas && !hoyCtas.error && !error && <CuentasDiarias cuentas={(hoyCtas.data ?? []) as CuentaHoy[]} finanzas={finanzas} />}
      {finanzas && !error && <SubirConciliacion />}
      {!error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><p className="text-xs text-amber-800">Por identificar (en plazo)</p><p className="text-xl font-bold text-amber-900">{libres.length - vencidos.length}</p></div>
          <div className={`rounded-xl border px-4 py-3 ${vencidos.length ? "border-red-300 bg-red-600 text-white" : "border-slate-200 bg-white"}`}><p className="text-xs">No identificados (+7 días)</p><p className="text-xl font-bold">{vencidos.length}</p></div>
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3"><p className="text-xs text-green-800">Identificados</p><p className="text-xl font-bold text-green-900">{todos.length - libres.length}</p>{previos > 0 && <p className="text-[11px] text-green-800">{previos} antes del portal</p>}</div>
        </div>
      )}
      {!error && todos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Pagos</h2>
          {!finanzas && <p className="text-xs text-slate-500">Puedes identificar un pago a nombre de un vendedor (o de alguien sin usuario en el portal).</p>}
          <ListaConciliacion movs={todos} modo={finanzas ? "finanzas" : "direccion"} uid={u.id} vendedores={(vends ?? []) as { id: string; nombre: string }[]} inicial={vencidos.length ? "vencidos" : "libres"} puedePrevio={["jefe_ventas", "gerente", "ceo", "comprador"].includes(u.rol)} />
        </section>
      )}
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
