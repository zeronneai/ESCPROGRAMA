import Link from "next/link";
import { KindBadgeStatic } from "@/components/kind-badge";
import { EmptyState } from "@/components/ui";
import { currentStage, RESULT_LABEL, STAGES, stageState, type BitacoraRow } from "@/lib/bitacora/stages";

export type BitacoraListRow = BitacoraRow & {
  customers: { id: string; nombre: string; tipo: "cliente" | "prospecto"; giro: string | null; estado_geo: string | null; contacto_nombre: string | null; contacto_telefono: string | null } | null;
  profiles?: { nombre: string } | null;
};

const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "-");
const money = (v: number | string | null, m: string) => (v === null || v === "" ? null : `$${Number(v).toLocaleString("es-MX", { maximumFractionDigits: 0 })} ${m}`);

/** Puntos de avance: una marca por etapa del formato. */
export function StageDots({ row }: { row: BitacoraRow }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`Etapa: ${currentStage(row).stage?.short ?? "Sin iniciar"}`}>
      {STAGES.map((s, i) => {
        const st = stageState(row, i);
        const cls = st === "done" ? "bg-green-600" : st === "na" ? "bg-slate-200" : st === "pending" ? "bg-amber-400" : "bg-slate-200";
        return <span key={s.key} title={`${s.short}${st === "na" ? " (no aplica)" : st === "pending" ? " (pendiente)" : ""}`} className={`h-1.5 w-4 rounded-full sm:w-5 ${cls}`} />;
      })}
    </div>
  );
}

/** Lista de registros de bitacora (vendedor o jefa). */
export function BitacoraList({ rows, hrefFor, showSeller = false, today }: { rows: BitacoraListRow[]; hrefFor: (id: string) => string; showSeller?: boolean; today: string }) {
  if (rows.length === 0) return <EmptyState title="No hay registros en esta vista" />;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => {
        const st = currentStage(r).stage;
        const seguimiento = r.proximo_seguimiento && r.resultado === "abierta" ? (r.proximo_seguimiento < today ? "vencido" : r.proximo_seguimiento === today ? "hoy" : "futuro") : null;
        return (
          <li key={r.id}>
            <Link href={hrefFor(r.id)} className="grid gap-2 px-4 py-3 hover:bg-slate-50 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  <span className="truncate">{r.customers?.nombre ?? "Cliente"}</span>
                  {r.customers && <KindBadgeStatic tipo={r.customers.tipo} />}
                  {!r.vendedor_id && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-900">Sin asignar</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[r.customers?.giro, r.customers?.estado_geo, r.customers?.contacto_nombre, r.customers?.contacto_telefono].filter(Boolean).join(" · ")}
                  {showSeller && r.profiles?.nombre && <> · <span className="text-slate-700">{r.profiles.nombre}</span></>}
                </p>
                {r.necesidad && <p className="truncate text-sm text-slate-600">{r.necesidad}</p>}
              </div>
              <div className="space-y-1">
                <StageDots row={r} />
                <p className="text-xs text-slate-600">
                  {r.resultado !== "abierta" ? <strong className={r.resultado === "ganada" ? "text-green-700" : "text-red-700"}>{RESULT_LABEL[r.resultado]}</strong> : st ? st.short : "Sin iniciar"}
                  {money(r.monto_venta, r.moneda) && <span className="text-slate-500"> · {money(r.monto_venta, r.moneda)}</span>}
                  {Number(r.cartera_monto ?? 0) > 0 && <span className="text-red-700"> · Cartera {money(r.cartera_monto, r.moneda)}</span>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs md:flex-col md:items-end">
                {seguimiento && (
                  <span className={`rounded-full px-2 py-0.5 font-medium ${seguimiento === "vencido" ? "bg-red-100 text-red-800" : seguimiento === "hoy" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`}>
                    Seguimiento {seguimiento === "hoy" ? "hoy" : fmt(r.proximo_seguimiento)}
                  </span>
                )}
                <span className="text-slate-400">Actualizado {new Date(r.updated_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
