import Link from "next/link";
import { EvalControls } from "@/components/eval/eval-controls";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { fechaLarga, loadPeriodos } from "@/lib/eval-server";
import { clasificacionProveedor } from "@/lib/evaluaciones";
import { createClient } from "@/lib/supabase/server";

type Row = { id: string; puntaje: number | null; comprador_at: string | null; almacen_at: string | null; suppliers: { nombre: string; giro: string | null } | null };

export default async function EvalProveedores({ searchParams }: { searchParams: Promise<{ periodo?: string; ver?: string }> }) {
  const u = await requireRoles(["comprador", "almacen", "supervisor_almacen", "gerente", "coordinador_iso"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { activo, programado, historial, actual } = await loadPeriodos(supabase, "proveedores", sp.periodo);
  const { data } = actual
    ? await supabase.from("eval_proveedor").select("id, puntaje, comprador_at, almacen_at, suppliers(nombre, giro)").eq("periodo_id", actual.id).limit(2000)
    : { data: [] };
  const all = ((data ?? []) as unknown as Row[]).sort((a, b) => (a.suppliers?.nombre ?? "").localeCompare(b.suppliers?.nombre ?? ""));
  const esAlm = u.rol === "almacen" || u.rol === "supervisor_almacen";
  const mine = esAlm ? "almacen_at" : "comprador_at";
  const ver = sp.ver ?? (u.rol === "comprador" || esAlm ? "pendientes" : "todos");
  const rows = all.filter((r) => (ver === "pendientes" ? !r[mine] : true));
  const completas = all.filter((r) => r.comprador_at && r.almacen_at);
  const prom = completas.length ? Math.round((completas.reduce((a, r) => a + Number(r.puntaje ?? 0), 0) / completas.length) * 10) / 10 : null;
  const canAct = u.rol === "comprador" && (!actual || actual.id === activo?.id || !activo);
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ periodo: sp.periodo, ver: sp.ver, ...o })) if (v) p.set(k, v);
    return `/evaluaciones/proveedores${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Evaluación de proveedores"
        subtitle="Dos veces al año. El comprador califica comunicación, entrega, precio, documentos y atención; Almacén califica lo que recibe."
      />
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {activo ? (
            <p><Chip cls="bg-green-100 text-green-800">Activa</Chip> <strong>{activo.nombre}</strong> desde el {fechaLarga(activo.activado_at)}</p>
          ) : (
            <p className="text-slate-700">No hay evaluación activa.{esAlm && " Te llegará un aviso cuando el comprador la active."}</p>
          )}
          {programado && <p className="mt-1 text-xs text-slate-500">La siguiente se activa sola el {fechaLarga(programado.programado_para)} y avisa en la campanita.</p>}
        </div>
        {canAct && <EvalControls tipo="proveedores" activo={!!activo} programado={programado?.programado_para ?? null} />}
      </Card>

      {actual && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Proveedores" value={all.length} />
            <StatCard label="Falta comprador" value={all.filter((r) => !r.comprador_at).length} tone={all.some((r) => !r.comprador_at) ? "amber" : "default"} />
            <StatCard label="Falta almacén" value={all.filter((r) => !r.almacen_at).length} tone={all.some((r) => !r.almacen_at) ? "amber" : "default"} />
            <StatCard label="Promedio" value={prom !== null ? `${prom}%` : "-"} hint={`${completas.length} completas`} tone={prom !== null && prom >= 85 ? "green" : "default"} />
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
            <FilterChip href={href({ ver: "pendientes" })} active={ver === "pendientes"}>Me faltan</FilterChip>
            <FilterChip href={href({ ver: "todos" })} active={ver === "todos"}>Todos</FilterChip>
            {historial.length > 1 && historial.map((p) => (
              <FilterChip key={p.id} href={href({ periodo: p.id })} active={p.id === actual.id}>{p.nombre}{p.estado === "activo" ? " (activa)" : ""}</FilterChip>
            ))}
          </div>
          <Card className="overflow-x-auto p-0">
            {rows.length === 0 ? (
              <EmptyState title={ver === "pendientes" ? "No te falta ninguno" : "Sin proveedores en este periodo"}>
                {u.rol === "comprador" && all.length === 0 && "Marca \"Evaluar\" en los proveedores para que entren."}
              </EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5">Proveedor</th><th className="px-3 py-2.5">Comprador</th><th className="px-3 py-2.5">Almacén</th><th className="px-3 py-2.5 text-right">Puntaje</th><th className="px-4 py-2.5" /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const cl = r.comprador_at && r.almacen_at ? clasificacionProveedor(r.puntaje) : null;
                    const st = (at: string | null) => (at ? <Chip cls="bg-green-100 text-green-800">Listo</Chip> : <Chip cls="bg-amber-100 text-amber-900">Pendiente</Chip>);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5"><p className="font-medium text-slate-900">{r.suppliers?.nombre}</p><p className="text-xs text-slate-500">{r.suppliers?.giro}</p></td>
                        <td className="px-3 py-2.5">{st(r.comprador_at)}</td>
                        <td className="px-3 py-2.5">{st(r.almacen_at)}</td>
                        <td className="px-3 py-2.5 text-right">{cl ? <Chip cls={cl.cls}>{r.puntaje}% · {cl.label}</Chip> : r.puntaje !== null ? <span className="text-xs text-slate-500">{r.puntaje}% parcial</span> : "-"}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/evaluaciones/proveedores/${r.id}`} className="font-medium text-brand-700 hover:underline">
                            {actual.estado === "activo" && (u.rol === "comprador" || esAlm) && !r[mine] ? "Evaluar" : "Ver"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          <p className="text-xs text-slate-500">Escala de 1 (malo) a 5 (excelente). Puntaje = promedio de los 10 puntos en %. Confiable 85% o más, Condicionado 70 a 84%, No confiable menos de 70% (rangos provisionales).</p>
        </>
      )}
    </div>
  );
}
