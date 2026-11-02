"use client";

import Link from "next/link";
import { quickVentaAction } from "@/actions/ventas";
import { Chip, useRun } from "@/components/ops-ui";
import { Alert, EmptyState } from "@/components/ui";
import { cobroEstado, diasVencidos, money, saldo, type VentaRow } from "@/lib/ventas";

export type VentaListRow = VentaRow & {
  customers: { nombre: string } | null;
  profiles?: { nombre: string } | null;
  venta_lineas: { descripcion: string; cantidad: number | null }[];
};

const dayLabel = (d: string, today: string) => {
  if (d === today) return "Hoy";
  const diff = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86_400_000);
  if (diff === 1) return "Ayer";
  return new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
};

export function VentasList({ rows, today, basePath, editable, showSeller = false }: { rows: VentaListRow[]; today: string; basePath: string; editable: boolean; showSeller?: boolean }) {
  const { run, busy, notice } = useRun();
  if (rows.length === 0) return <EmptyState title="Sin ventas en esta vista" />;
  const days = [...new Set(rows.map((r) => r.fecha))];
  return (
    <div>
      {notice && <div className="p-3"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {days.map((d) => {
        const list = rows.filter((r) => r.fecha === d);
        const total = list.filter((r) => !r.cancelada_at && r.moneda === "MXN").reduce((a, r) => a + Number(r.monto ?? 0), 0);
        return (
          <section key={d}>
            <div className="flex items-center justify-between border-y border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 first:border-t-0">
              <span>{dayLabel(d, today)}</span>
              <span className="normal-case tracking-normal">{list.length} venta(s){total ? ` · ${money(total)}` : ""}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((r) => {
                const st = cobroEstado(r, today);
                return (
                  <li key={r.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${r.cancelada_at ? "opacity-50" : ""}`}>
                    <Link href={`${basePath}/${r.id}`} className="min-w-0 flex-1 hover:opacity-80">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        <span className="truncate">{r.customers?.nombre ?? "Cliente"}</span>
                        {r.monto != null && <span className="text-sm font-semibold text-slate-700">{money(Number(r.monto), r.moneda)}</span>}
                        {r.origen === "portal" && !r.factura && <Chip cls="bg-brand-100 text-brand-900">Del portal: complétala</Chip>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {r.venta_lineas.map((l) => `${l.cantidad ? `${Number(l.cantidad).toLocaleString("es-MX")} × ` : ""}${l.descripcion.split(",")[0]}`).join(" · ") || "Sin artículos"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[r.factura && `Factura ${r.factura}`, r.pedido, r.pago === "credito" ? `Crédito ${r.dias_credito} días` : "Contado", showSeller && r.profiles?.nombre].filter(Boolean).join(" · ")}
                      </p>
                    </Link>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                      {r.cancelada_at ? (
                        <Chip cls="bg-slate-200 text-slate-700">Cancelada</Chip>
                      ) : (
                        <>
                          {editable && !r.entregado ? (
                            <button type="button" disabled={!!busy} onClick={() => run(`e${r.id}`, () => quickVentaAction(r.id, { entregado: true }))} className="rounded-full border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-100">
                              {busy === `e${r.id}` ? "..." : "Marcar entregada"}
                            </button>
                          ) : (
                            <Chip cls={r.entregado ? "bg-teal-100 text-teal-800" : "bg-slate-100 text-slate-600"}>{r.entregado ? "Entregada" : "Por entregar"}</Chip>
                          )}
                          {st === "cobrada" ? (
                            <Chip cls="bg-green-100 text-green-800">Cobrada</Chip>
                          ) : (
                            <>
                              <Chip cls={st === "vencida" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}>
                                {st === "vencida" ? `Vencida ${diasVencidos(r, today)} d · ${money(saldo(r), r.moneda)}` : `Por cobrar ${money(saldo(r), r.moneda)}`}
                              </Chip>
                              {editable && (
                                <button type="button" disabled={!!busy} onClick={() => run(`c${r.id}`, () => quickVentaAction(r.id, { porcentaje_cobrado: 100 }))} className="rounded-full border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-100">
                                  {busy === `c${r.id}` ? "..." : "Cobrada"}
                                </button>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
