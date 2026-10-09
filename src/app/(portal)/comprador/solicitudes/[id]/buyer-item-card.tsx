"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { requestClarificationAction } from "@/actions/clarifications";
import { respondNotFoundAction, respondQuoteAction } from "@/actions/responses";
import { respondRevisionAction } from "@/actions/revisions";
import { getSourcingBaseAction, saveSourcingAction, type SimilarQuote } from "@/actions/sourcing";
import { ItemChat } from "@/components/item-chat";
import { QuoteForm, type Factors } from "@/components/quote-form";
import { SimilarQuotes } from "@/components/similar-quotes";
import { emptySourcing, SourcingPanel } from "@/components/sourcing-panel";
import { ItemStatusBadge, qtyText, ReferenceList, SemaforoBadge } from "@/components/status";
import { Alert, Button, Card, Field } from "@/components/ui";
import { formatDelivery, formatMinPurchase } from "@/lib/format/quote-text";
import { isVigenciaVencida, revisionFolio } from "@/lib/quotes/revisions";
import { latestOutcome, latestQuote, LOSS_REASON_LABEL, openPause, openUpdateRequest, type ItemRow, type QuoteRow } from "@/lib/quotes/types";
import { emptyQuoteForm, parseQuoteForm, type QuoteFormValues } from "@/lib/validation/response";

export interface CostRow {
  version: number;
  costo: number | string;
  envio: number | string | null;
  base: number | string;
  proveedor: string | null;
}

export type BuyerItem = ItemRow & {
  item_costs: CostRow[];
  item_sourcing: { proveedor: string | null; link_producto: string | null; contacto: string | null; numero_parte: string | null; notas_compra: string | null } | null;
  item_purchases: { comprada_at: string | null } | null;
};

/** Formulario precargado con la version anterior (para "Actualizar costo"). */
function formFromVersion(q: QuoteRow, c: CostRow | undefined): QuoteFormValues {
  return {
    costo: c ? String(Number(c.costo)) : "",
    envio: c?.envio ? String(Number(c.envio)) : "",
    moneda: q.moneda,
    entregaModo: q.entrega_fecha && q.entrega_dias === null ? "fecha" : "dias",
    entregaDias: q.entrega_dias === null ? "" : String(q.entrega_dias),
    entregaTipo: q.entrega_tipo ?? "habiles",
    entregaFecha: q.entrega_fecha ?? "",
    minModo: q.compra_min_cantidad ? "cantidad" : q.compra_min_monto ? "monto" : "ninguna",
    minCantidad: q.compra_min_cantidad ? String(Number(q.compra_min_cantidad)) : "",
    minUnidad: q.compra_min_unidad ?? "pieza",
    minMonto: q.compra_min_monto ? String(Number(q.compra_min_monto)) : "",
    proveedor: c?.proveedor ?? "",
    nota: "",
  };
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" });

export function BuyerItemCard({
  item, requestId, factors, proveedores, remaining, updateRemaining, nowIso,
}: {
  item: BuyerItem;
  requestId: string;
  factors: Factors;
  proveedores: string[];
  remaining: number;
  updateRemaining: number | null;
  nowIso: string;
}) {
  const router = useRouter();
  const now = new Date(nowIso);
  const [pending, start] = useTransition();
  const q = latestQuote(item);
  const costs = [...(item.item_costs ?? [])].sort((a, b) => b.version - a.version);
  const cost = costs[0];
  const d = q ? item.item_dispatch.find((x) => x.quote_version === q.version) : undefined;
  const outcome = latestOutcome(item);
  const open = openUpdateRequest(item);
  const pause = openPause(item);
  const locked = item.estado === "cotizada" || item.estado === "enviada_cliente";
  const respondable = item.estado === "pendiente" || item.estado === "no_encontrada";
  const vencida = isVigenciaVencida(q, now);

  const [mode, setMode] = useState<"quote" | "not_found">(item.estado === "no_encontrada" ? "not_found" : "quote");
  const [editing, setEditing] = useState(item.estado === "pendiente");
  const [form, setForm] = useState<QuoteFormValues>(emptyQuoteForm);
  const [nota, setNota] = useState(item.not_found_note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [sourcing, setSourcing] = useState(() => ({
    ...emptySourcing,
    proveedor: item.item_sourcing?.proveedor ?? "",
    link_producto: item.item_sourcing?.link_producto ?? "",
    contacto: item.item_sourcing?.contacto ?? "",
    numero_parte: item.item_sourcing?.numero_parte ?? "",
    notas_compra: item.item_sourcing?.notas_compra ?? "",
  }));
  const [updateMode, setUpdateMode] = useState<"confirm" | "update_cost" | null>(null);
  const [updateForm, setUpdateForm] = useState<QuoteFormValues>(() => (q ? formFromVersion(q, cost) : emptyQuoteForm));
  const [confirmNota, setConfirmNota] = useState("");
  const [clar, setClar] = useState("");
  const [showClar, setShowClar] = useState(false);

  function useAsBase(r: SimilarQuote) {
    setForm((f) => ({ ...f, costo: String(Number(r.costo)), envio: r.envio ? String(Number(r.envio)) : "", moneda: r.moneda, proveedor: r.proveedor ?? f.proveedor }));
    setMode("quote");
    setNotice({ tone: "success", text: "Formulario precargado con esa cotización. Revisa los datos antes de guardar." });
    void getSourcingBaseAction(r.item_id).then((res) => {
      if (res.ok && res.sourcing) setSourcing(res.sourcing);
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; problems?: string[] }>, okText: string, after?: () => void) {
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setNotice({ tone: "error", text: r.problems?.length ? `${r.error}: ${r.problems.join("; ")}` : (r.error ?? "Error") });
      else {
        setNotice({ tone: "success", text: okText });
        after?.();
        router.refresh();
      }
    });
  }

  function submitQuote() {
    const parsed = parseQuoteForm(form);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    run(async () => {
      // Si capturaste datos de abastecimiento, se guardan junto con la cotizacion.
      const src = { ...sourcing, proveedor: sourcing.proveedor.trim() || form.proveedor.trim() };
      if (Object.values(src).some((v) => v.trim())) {
        const s = await saveSourcingAction(item.id, src);
        if (!s.ok) return s;
      }
      return respondQuoteAction(item.id, form);
    }, "Cotización guardada. Quedó bloqueada y el vendedor ya puede verla.", () => setEditing(false));
  }

  function submitUpdateCost() {
    const parsed = parseQuoteForm(updateForm);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    run(() => respondRevisionAction(item.id, "update_cost", updateForm), "Nueva versión creada con los factores vigentes.", () => setUpdateMode(null));
  }

  const folio = q ? revisionFolio(item.folio!, q.version) : item.folio;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">{folio}</p>
          <h2 className="font-medium">{item.producto}</h2>
          <p className="text-sm text-slate-600">{item.descripcion}</p>
          <p className="mt-1 text-sm">{qtyText(item.cantidad, item.unidad, item.talla)}</p>
          {item.notas && <p className="text-xs text-slate-500">Notas del vendedor: {item.notas}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vencida && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Vigencia vencida</span>}
          <ItemStatusBadge estado={item.estado} vencida={item.estado === "pendiente" && remaining <= 0} />
          {item.estado === "pendiente" && <SemaforoBadge remaining={remaining} />}
          {item.estado === "esperando_aclaracion" && <span className="text-xs text-purple-700">Reloj en pausa</span>}
        </div>
      </div>
      <ReferenceList refs={item.item_references} />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {pause && <Alert tone="info">Esperando aclaración del vendedor desde {fmtDate(pause.clarification_requested_at)}. El reloj de 48 horas hábiles está en pausa.</Alert>}

      {/* Cotizacion registrada (bloqueada) */}
      {q && (locked || item.estado === "actualizacion_solicitada") && (
        <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium">Cotización v{q.version} registrada (bloqueada)</p>
          {cost && (
            <p className="text-slate-700">
              Costo ${Number(cost.costo).toFixed(2)} · Envío {cost.envio ? `$${Number(cost.envio).toFixed(2)}` : "sin envío"} · Base ${Number(cost.base).toFixed(2)} · Proveedor {cost.proveedor ?? "sin proveedor"}
            </p>
          )}
          <p>Precios ({q.moneda}): {[q.price_1, q.price_2, q.price_3, q.price_4, q.price_5].map((p, i) => `P${i + 1} $${Number(p).toFixed(2)}`).join(" · ")}</p>
          <p>
            Entrega: {formatDelivery(q)} · Compra mínima: {formatMinPurchase(q) ?? "sin mínimo"} · Vigencia hasta {q.valid_until ? fmtDate(q.valid_until) : "-"}
            {vencida ? " (vencida)" : ""}
          </p>
          {q.nota && <p>Nota: {q.nota}</p>}
          {d && <p className="text-slate-600">El vendedor lo envió al cliente con el Precio {d.precio_elegido}.</p>}
          {outcome && outcome.resultado !== "sin_respuesta" && (
            <p className="font-medium">
              Resultado: {outcome.resultado === "ganada" ? "Ganada" : `Perdida (${outcome.motivo ? LOSS_REASON_LABEL[outcome.motivo] : ""}${outcome.motivo_texto ? `: ${outcome.motivo_texto}` : ""})`}
              {outcome.resultado === "ganada" && outcome.cantidad_final ? `, cantidad final ${Number(outcome.cantidad_final)}` : ""}
            </p>
          )}
          {costs.length > 1 && (
            <details>
              <summary className="cursor-pointer text-slate-600">Versiones anteriores ({costs.length - 1})</summary>
              <ul className="mt-1 space-y-1 text-xs">
                {item.item_quotes.filter((v) => v.version !== q.version).sort((a, b) => b.version - a.version).map((v) => {
                  const c = costs.find((x) => x.version === v.version);
                  return (
                    <li key={v.version}>v{v.version} ({fmtDate(v.quoted_at)}): costo ${c ? Number(c.costo).toFixed(2) : "-"}, envío {c?.envio ? `$${Number(c.envio).toFixed(2)}` : "sin envío"}, P1 ${Number(v.price_1).toFixed(2)} ... P5 ${Number(v.price_5).toFixed(2)} {v.moneda}</li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Actualizacion solicitada por el vendedor */}
      {item.estado === "actualizacion_solicitada" && open && q && (
        <div className="space-y-3 rounded-md border border-orange-300 bg-orange-50 p-3">
          <p className="text-sm font-medium text-orange-900">
            Actualización solicitada el {fmtDate(open.requested_at)}
            {updateRemaining !== null && <SemaforoBadge remaining={updateRemaining} />}
          </p>
          {open.nota && <p className="text-sm">Nota del vendedor: {open.nota}</p>}
          {!updateMode && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={() => setUpdateMode("confirm")}>Confirmar sin cambios</Button>
              <Button variant="secondary" disabled={pending} onClick={() => setUpdateMode("update_cost")}>Actualizar costo</Button>
            </div>
          )}
          {updateMode === "confirm" && (
            <div className="space-y-2">
              <p className="text-sm">Se crea la versión {q.version + 1} con los mismos costos y precios, y una vigencia nueva.</p>
              <Field label="Nota (opcional, la ve el vendedor)">
                <input value={confirmNota} onChange={(e) => setConfirmNota(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </Field>
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => run(() => respondRevisionAction(item.id, "confirm", undefined, confirmNota), "Cotización confirmada con una versión nueva.", () => setUpdateMode(null))}>
                  Confirmar versión {q.version + 1}
                </Button>
                <Button variant="ghost" onClick={() => setUpdateMode(null)}>Cancelar</Button>
              </div>
            </div>
          )}
          {updateMode === "update_cost" && (
            <div className="space-y-2">
              <p className="text-sm">Captura el costo y el envío nuevos: los 5 precios se recalculan con los factores vigentes ahora. Las condiciones vienen de la versión anterior.</p>
              <QuoteForm form={updateForm} setForm={setUpdateForm} errors={errors} factors={factors} proveedores={proveedores} cantidad={item.cantidad} listId={`provs-upd-${item.id}`} />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={submitUpdateCost}>Guardar versión {q.version + 1}</Button>
                <Button variant="ghost" onClick={() => setUpdateMode(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No encontrada: reabrir */}
      {item.estado === "no_encontrada" && !editing && (
        <div className="space-y-2">
          <Alert tone="info"><strong>No encontrada:</strong> {item.not_found_note}</Alert>
          <Button variant="secondary" onClick={() => setEditing(true)}>Reabrir (editar nota o cotizar)</Button>
        </div>
      )}

      {/* Responder (pendiente / no encontrada) */}
      {respondable && editing && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="flex gap-2">
            <Button variant={mode === "quote" ? "primary" : "secondary"} onClick={() => setMode("quote")}>Cotizada</Button>
            <Button variant={mode === "not_found" ? "primary" : "secondary"} onClick={() => setMode("not_found")}>No encontrada</Button>
          </div>
          {mode === "not_found" ? (
            <div className="space-y-2">
              <Field label="Nota (obligatoria): por qué no se encontró" error={errors.nota}>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </Field>
              <Button
                disabled={pending}
                onClick={() => run(async () => {
                  const r = await respondNotFoundAction(item.id, nota);
                  if (!r.ok) setErrors({ nota: r.error });
                  return r;
                }, "Marcada como no encontrada. Puedes cotizarla después si la encuentras.", () => setEditing(false))}
              >
                Guardar como no encontrada
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <SimilarQuotes itemId={item.id} producto={item.producto} onUse={useAsBase} />
              <QuoteForm form={form} setForm={setForm} errors={errors} factors={factors} proveedores={proveedores} cantidad={item.cantidad} listId={`provs-${item.id}`} />
              {!sourcing.proveedor.trim() && !sourcing.link_producto.trim() && (
                <p className="text-xs text-amber-800">Recordatorio: anota dónde conseguirlo (proveedor o link) en la sección interna de abajo.</p>
              )}
              <Button onClick={submitQuote} disabled={pending}>Guardar cotización</Button>
              <p className="text-xs text-amber-800">Al guardar, la cotización queda bloqueada y no se podrá editar.</p>
            </div>
          )}
        </div>
      )}

      {/* Dónde conseguirlo (interno): siempre editable */}
      <SourcingPanel
        itemId={item.id}
        values={sourcing}
        setValues={setSourcing}
        proveedores={proveedores}
        listId={`provs-src-${item.id}`}
        showReminder={respondable && editing && mode === "quote"}
        comprada={outcome?.resultado === "ganada" ? { at: item.item_purchases?.comprada_at ?? null } : undefined}
      />

      {/* Pedir aclaración */}
      {(item.estado === "pendiente" || item.estado === "no_encontrada" || item.estado === "actualizacion_solicitada") && (
        <div>
          {!showClar ? (
            <Button variant="ghost" onClick={() => setShowClar(true)}>Pedir aclaración al vendedor</Button>
          ) : (
            <div className="space-y-2 rounded-md border border-purple-200 bg-purple-50 p-3">
              <Field label="Pregunta para el vendedor (el reloj de 48 horas hábiles se pausa hasta que responda)">
                <textarea value={clar} onChange={(e) => setClar(e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </Field>
              <div className="flex gap-2">
                <Button disabled={pending || !clar.trim()} onClick={() => run(() => requestClarificationAction(item.id, clar), "Aclaración solicitada. El reloj quedó en pausa.", () => { setClar(""); setShowClar(false); })}>
                  Pedir aclaración
                </Button>
                <Button variant="ghost" onClick={() => setShowClar(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ItemChat itemId={item.id} requestId={requestId} me="comprador" messages={item.item_messages ?? []} waitingForSeller={!!pause} />
    </Card>
  );
}
