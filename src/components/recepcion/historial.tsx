"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { notaEntregaAction, revisarFacturaAction } from "@/actions/recepcion";
import { toast } from "@/components/feedback-global";
import { Button, Card, Input } from "@/components/ui";
import { fechaCorta, FORMAS_PAGO, type EntregaRec, type FacturaRec } from "@/lib/recepcion";
import { money } from "@/lib/ventas";

const ESTADO = {
  por_revisar: { label: "Por revisar", cls: "bg-amber-100 text-amber-800" },
  recibida: { label: "✓ Recibida", cls: "bg-green-600 text-white" },
  rechazada: { label: "Rechazada", cls: "bg-red-100 text-red-800" },
} as const;

const MOTIVOS = ["No vino la factura física", "La factura física no coincide (monto o folio)", "Falta el comprobante de pago", "El pago no cubre la factura"];

/**
 * Entregas de facturas con sus pagos.
 * - vendedor: ve el estado de cada factura, los motivos de rechazo y las anotaciones (puede responder).
 * - finanzas: busca por folio, palomea Recibida o Rechaza con motivo, y anota.
 * - lectura: solo ve (jefa de ventas).
 */
export function EntregasHistorial({ entregas, modo }: { entregas: EntregaRec[]; modo: "vendedor" | "finanzas" | "lectura" }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [buscar, setBuscar] = useState("");
  const [ver, setVer] = useState<"pendientes" | "todas">(modo === "finanzas" ? "pendientes" : "todas");
  const [rechazo, setRechazo] = useState<{ id: string; motivo: string } | null>(null);
  const [nota, setNota] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const finanzas = modo === "finanzas";

  const t = buscar.trim().toLowerCase();
  const coincide = (f: FacturaRec, ref: string | null) => !t || [f.factura ?? "", f.cliente, ref ?? ""].some((x) => x.toLowerCase().includes(t));
  const lista = useMemo(
    () =>
      entregas
        .filter((e) => ver === "todas" || e.pagos.some((p) => p.facturas.some((f) => f.estado === "por_revisar")) || !!t)
        .map((e) => ({ ...e, pagos: e.pagos.map((p) => ({ ...p, facturas: p.facturas.filter((f) => coincide(f, p.referencia)) })).filter((p) => p.facturas.length > 0) }))
        .filter((e) => e.pagos.length > 0 || (!t && e.notasLista.length > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entregas, ver, t],
  );
  const todas = entregas.flatMap((e) => e.pagos.flatMap((p) => p.facturas));
  const porRevisar = todas.filter((f) => f.estado === "por_revisar").length;

  const revisar = (f: FacturaRec, estado: "por_revisar" | "recibida" | "rechazada", motivo?: string) => {
    setOcupado(f.id);
    start(async () => {
      const r = await revisarFacturaAction(f.id, estado, motivo);
      setOcupado(null);
      if (!r.ok) return toast(r.error, "error");
      if (estado === "recibida") toast(`${f.factura} recibida`, "success");
      if (estado === "rechazada") toast(`${f.factura} rechazada: le avisamos al vendedor`, "success");
      setRechazo(null);
      router.refresh();
    });
  };
  const anotar = (entregaId: string) =>
    start(async () => {
      const r = await notaEntregaAction(entregaId, nota[entregaId] ?? "");
      if (!r.ok) return toast(r.error, "error");
      setNota((n) => ({ ...n, [entregaId]: "" }));
      toast("Anotación guardada", "success");
      router.refresh();
    });
  // Enter en el buscador: si solo hay una factura por revisar con ese folio, se marca recibida.
  const enter = () => {
    if (!finanzas || !t) return;
    const m = entregas.flatMap((e) => e.pagos.flatMap((p) => p.facturas.filter((f) => f.estado === "por_revisar" && coincide(f, p.referencia))));
    const exacta = m.filter((f) => (f.factura ?? "").toLowerCase() === t);
    const una = exacta.length === 1 ? exacta[0] : m.length === 1 ? m[0] : null;
    if (una) {
      revisar(una, "recibida");
      setBuscar("");
    } else toast(m.length ? `Hay ${m.length} coincidencias: palomea la correcta` : "No está en la lista: agrégalo como anotación", "info");
  };

  if (entregas.length === 0) return <Card className="text-sm text-slate-600">{modo === "vendedor" ? "Todavía no entregas facturas a finanzas." : "Este vendedor no ha entregado facturas."}</Card>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } }}
          placeholder={finanzas ? "Escribe el folio de la factura física (Enter = recibida)" : "Buscar factura, cliente o referencia"}
          className="min-w-64 flex-1 text-base"
          autoFocus={finanzas}
        />
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(["pendientes", "todas"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVer(v)} className={`rounded px-3 py-1 ${ver === v ? "bg-slate-800 text-white" : "text-slate-600"}`}>
              {v === "pendientes" ? `Por revisar ${porRevisar}` : "Todas"}
            </button>
          ))}
        </div>
      </div>
      {lista.length === 0 && <Card className="text-sm text-slate-600">{t ? "Ninguna factura coincide. Si la trajo en físico y no está en la lista, déjalo como anotación en su entrega." : "No hay facturas por revisar."}</Card>}
      {lista.map((e) => {
        const n = e.pagos.reduce((a, p) => a + p.facturas.length, 0);
        return (
          <Card key={e.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-900">Entrega {e.folio}</p>
                <p className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })} · {n} factura(s) · {e.pagos.length} pago(s)</p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.estado === "revisada" ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-800"}`}>{e.estado === "revisada" ? "Revisada" : "En revisión"}</span>
            </div>
            {e.notas && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">Nota del vendedor: {e.notas}</p>}
            {e.pagos.map((p, i) => {
              const suma = p.facturas.reduce((a, f) => a + f.monto, 0);
              return (
                <div key={p.id} className="rounded-lg border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-semibold text-slate-800">
                      Pago {i + 1}: {money(p.monto, p.moneda)} · {FORMAS_PAGO[p.forma]} · {fechaCorta(p.fecha)}
                      {p.referencia ? ` · Ref. ${p.referencia}` : ""}
                    </span>
                    <span className={`text-xs ${Math.abs(p.monto - suma) >= 1 && !t ? "font-semibold text-amber-800" : "text-slate-500"}`}>{t ? "" : `Facturas: ${money(suma, p.moneda)}`}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {p.facturas.map((f) => (
                      <div key={f.id} className={`space-y-2 px-3 py-2.5 ${f.estado === "recibida" ? "bg-green-50/60" : f.estado === "rechazada" ? "bg-red-50/60" : ""}`}>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="min-w-0 flex-1 text-sm">
                            <span className={`font-semibold text-slate-900 ${t && (f.factura ?? "").toLowerCase() === t ? "rounded bg-yellow-200 px-1" : ""}`}>{f.factura}</span>
                            <span className="block truncate text-xs text-slate-500">{f.cliente} · factura del {fechaCorta(f.fecha_factura)} · pagada el {fechaCorta(p.fecha)}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-sm text-slate-700">{money(f.monto, f.moneda)}</span>
                          {finanzas && f.estado === "por_revisar" ? (
                            <span className="flex shrink-0 gap-1.5">
                              <Button type="button" className="bg-green-600! px-3 text-xs hover:bg-green-700!" loading={pend && ocupado === f.id} onClick={() => revisar(f, "recibida")}>✓ Recibida</Button>
                              <Button type="button" variant="secondary" className="px-3 text-xs text-red-700" onClick={() => setRechazo({ id: f.id, motivo: "" })}>Rechazar</Button>
                            </span>
                          ) : (
                            <span className="flex shrink-0 items-center gap-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO[f.estado].cls}`}>{ESTADO[f.estado].label}</span>
                              {finanzas && <button type="button" disabled={pend} onClick={() => revisar(f, "por_revisar")} className="text-xs text-slate-500 hover:underline">Deshacer</button>}
                            </span>
                          )}
                        </div>
                        {f.estado === "rechazada" && f.motivo && <p className="text-xs font-medium text-red-800">Motivo: {f.motivo}{modo === "vendedor" ? " · ya puedes volver a entregarla" : ""}</p>}
                        {rechazo?.id === f.id && (
                          <div className="space-y-2 rounded-md border border-red-200 bg-white p-2">
                            <div className="flex flex-wrap gap-1.5">
                              {MOTIVOS.map((m) => (
                                <button key={m} type="button" onClick={() => setRechazo({ id: f.id, motivo: m })} className={`rounded-full border px-2.5 py-1 text-xs ${rechazo.motivo === m ? "border-red-600 bg-red-600 text-white" : "border-slate-300 text-slate-700"}`}>{m}</button>
                              ))}
                            </div>
                            <Input value={rechazo.motivo} maxLength={500} onChange={(ev) => setRechazo({ id: f.id, motivo: ev.target.value })} placeholder="¿Por qué se rechaza?" />
                            <div className="flex gap-2">
                              <Button type="button" variant="danger" className="text-xs" disabled={!rechazo.motivo.trim()} loading={pend && ocupado === f.id} onClick={() => revisar(f, "rechazada", rechazo.motivo)}>Rechazar factura</Button>
                              <Button type="button" variant="secondary" className="text-xs" onClick={() => setRechazo(null)}>Cancelar</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {(e.notasLista.length > 0 || modo !== "lectura") && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Anotaciones</p>
                {e.notasLista.map((nn) => (
                  <p key={nn.id} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    <b>{nn.autor_nombre ?? "?"}</b> · {new Date(nn.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}: {nn.texto}
                  </p>
                ))}
                {modo !== "lectura" && (
                  <div className="flex gap-2">
                    <Input
                      value={nota[e.id] ?? ""}
                      maxLength={1000}
                      onChange={(ev) => setNota((x) => ({ ...x, [e.id]: ev.target.value }))}
                      placeholder={finanzas ? "Ej. Trajo la factura A-123 y no está en la lista / Falta la factura A-120" : "Responder a finanzas"}
                    />
                    <Button type="button" variant="secondary" className="shrink-0 text-xs" disabled={!(nota[e.id] ?? "").trim()} onClick={() => anotar(e.id)}>Anotar</Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
