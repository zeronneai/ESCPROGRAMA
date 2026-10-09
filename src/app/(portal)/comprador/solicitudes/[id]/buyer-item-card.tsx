"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { respondNotFoundAction, respondQuoteAction } from "@/actions/responses";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { ItemStatusBadge, qtyText, ReferenceList } from "@/components/status";
import { formatDelivery, formatMinPurchase } from "@/lib/format/quote-text";
import { calcTabulador, lineTotal, type PricingFactors } from "@/lib/pricing/tabulador";
import { latestDispatch, latestQuote, type ItemRow } from "@/lib/quotes/types";
import { UNIDADES } from "@/lib/validation/request";
import { emptyQuoteForm, parseQuoteForm, type QuoteFormValues } from "@/lib/validation/response";

export type Factors = PricingFactors & { noShippingMarkup: string };

export interface CostRow {
  version: number;
  costo: number | string;
  envio: number | string | null;
  base: number | string;
  proveedor: string | null;
}

export function BuyerItemCard({
  item,
  factors,
  proveedores,
  requestOverdue,
}: {
  item: ItemRow & { item_costs: CostRow[] };
  factors: Factors;
  proveedores: string[];
  requestOverdue: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"quote" | "not_found">(item.estado === "no_encontrada" ? "not_found" : "quote");
  const [form, setForm] = useState<QuoteFormValues>(emptyQuoteForm);
  const [nota, setNota] = useState(item.not_found_note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [editing, setEditing] = useState(item.estado === "pendiente");

  const q = latestQuote(item);
  const d = latestDispatch(item);
  const cost = [...(item.item_costs ?? [])].sort((a, b) => b.version - a.version)[0];
  const locked = item.estado === "cotizada" || item.estado === "enviada_cliente";
  const set = <K extends keyof QuoteFormValues>(k: K, v: QuoteFormValues[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Vista previa en vivo con los factores vigentes.
  const preview = useMemo(() => {
    const c = Number(form.costo.replace(/,/g, ""));
    const e = Number(form.envio.replace(/,/g, "") || 0);
    if (!form.costo.trim() || !(c > 0) || Number.isNaN(e) || e < 0) return null;
    try {
      return calcTabulador(c, e, factors);
    } catch {
      return null;
    }
  }, [form.costo, form.envio, factors]);
  const hasQty = item.cantidad !== null && Number(item.cantidad) > 0;
  const withShipping = Number(form.envio.replace(/,/g, "") || 0) > 0;

  function submitQuote() {
    setNotice(null);
    const parsed = parseQuoteForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    start(async () => {
      const r = await respondQuoteAction(item.id, form);
      if (!r.ok) setNotice({ tone: "error", text: r.error });
      else {
        setNotice({ tone: "success", text: "Cotizacion guardada. Quedo bloqueada y el vendedor ya puede verla." });
        setEditing(false);
        router.refresh();
      }
    });
  }

  function submitNotFound() {
    setNotice(null);
    start(async () => {
      const r = await respondNotFoundAction(item.id, nota);
      if (!r.ok) {
        setErrors({ nota: r.error });
        return;
      }
      setErrors({});
      setNotice({ tone: "success", text: "Marcada como no encontrada. Puedes cotizarla despues si la encuentras." });
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">{item.folio}</p>
          <h2 className="font-medium">{item.producto}</h2>
          <p className="text-sm text-slate-600">{item.descripcion}</p>
          <p className="mt-1 text-sm">{qtyText(item.cantidad, item.unidad, item.talla)}</p>
          {item.notas && <p className="text-xs text-slate-500">Notas del vendedor: {item.notas}</p>}
        </div>
        <div className="flex items-center gap-2">
          {item.first_response_at && item.estado !== "pendiente" && requestOverdue && (
            <span className="text-xs text-slate-500">(plazo vencido)</span>
          )}
          <ItemStatusBadge estado={item.estado} vencida={requestOverdue} />
        </div>
      </div>
      <ReferenceList refs={item.item_references} />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {locked && q && (
        <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium">Cotizacion registrada (bloqueada)</p>
          {cost && (
            <p className="text-slate-700">
              Costo ${Number(cost.costo).toFixed(2)} · Envio {cost.envio ? `$${Number(cost.envio).toFixed(2)}` : "sin envio"} · Base $
              {Number(cost.base).toFixed(2)} · Proveedor {cost.proveedor ?? "sin proveedor"}
            </p>
          )}
          <p>
            Precios ({q.moneda}): {[q.price_1, q.price_2, q.price_3, q.price_4, q.price_5].map((p, i) => `P${i + 1} $${Number(p).toFixed(2)}`).join(" · ")}
          </p>
          <p>
            Entrega: {formatDelivery(q)} · Compra minima: {formatMinPurchase(q) ?? "sin minimo"}
          </p>
          {q.nota && <p>Nota: {q.nota}</p>}
          {d && <p className="text-slate-600">El vendedor lo envio al cliente con el Precio {d.precio_elegido}.</p>}
        </div>
      )}

      {!locked && item.estado === "no_encontrada" && !editing && (
        <div className="space-y-2">
          <Alert tone="info">
            <strong>No encontrada:</strong> {item.not_found_note}
          </Alert>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Reabrir (editar nota o cotizar)
          </Button>
        </div>
      )}

      {!locked && editing && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="flex gap-2">
            <Button variant={mode === "quote" ? "primary" : "secondary"} onClick={() => setMode("quote")}>
              Cotizada
            </Button>
            <Button variant={mode === "not_found" ? "primary" : "secondary"} onClick={() => setMode("not_found")}>
              No encontrada
            </Button>
          </div>

          {mode === "not_found" ? (
            <div className="space-y-2">
              <Field label="Nota (obligatoria): por que no se encontro" error={errors.nota}>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </Field>
              <Button onClick={submitNotFound} disabled={pending}>
                Guardar como no encontrada
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Costo del producto *" error={errors.costo}>
                  <Input value={form.costo} onChange={(e) => set("costo", e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Costo de envio (opcional)" error={errors.envio}>
                  <Input value={form.envio} onChange={(e) => set("envio", e.target.value)} inputMode="decimal" placeholder="0 = sin envio" />
                </Field>
                <Field label="Moneda *" error={errors.moneda}>
                  <Select value={form.moneda} onChange={(e) => set("moneda", e.target.value)}>
                    <option value="MXN">MXN</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tiempo de entrega *">
                  <Select value={form.entregaModo} onChange={(e) => set("entregaModo", e.target.value as "dias" | "fecha")}>
                    <option value="dias">En dias</option>
                    <option value="fecha">Fecha estimada</option>
                  </Select>
                </Field>
                {form.entregaModo === "dias" ? (
                  <>
                    <Field label="Dias" error={errors.entregaDias}>
                      <Input value={form.entregaDias} onChange={(e) => set("entregaDias", e.target.value)} inputMode="numeric" />
                    </Field>
                    <Field label="Tipo" error={errors.entregaTipo}>
                      <Select value={form.entregaTipo} onChange={(e) => set("entregaTipo", e.target.value)}>
                        <option value="habiles">Habiles</option>
                        <option value="naturales">Naturales</option>
                      </Select>
                    </Field>
                  </>
                ) : (
                  <Field label="Fecha" error={errors.entregaFecha}>
                    <Input type="date" value={form.entregaFecha} onChange={(e) => set("entregaFecha", e.target.value)} />
                  </Field>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Compra minima (opcional)">
                  <Select value={form.minModo} onChange={(e) => set("minModo", e.target.value as QuoteFormValues["minModo"])}>
                    <option value="ninguna">Sin minimo</option>
                    <option value="cantidad">Por cantidad</option>
                    <option value="monto">Por monto</option>
                  </Select>
                </Field>
                {form.minModo === "cantidad" && (
                  <>
                    <Field label="Cantidad minima" error={errors.minCantidad}>
                      <Input value={form.minCantidad} onChange={(e) => set("minCantidad", e.target.value)} inputMode="decimal" />
                    </Field>
                    <Field label="Unidad" error={errors.minUnidad}>
                      <Select value={form.minUnidad} onChange={(e) => set("minUnidad", e.target.value)}>
                        {UNIDADES.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </>
                )}
                {form.minModo === "monto" && (
                  <Field label={`Monto minimo (${form.moneda})`} error={errors.minMonto}>
                    <Input value={form.minMonto} onChange={(e) => set("minMonto", e.target.value)} inputMode="decimal" />
                  </Field>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Proveedor (opcional)">
                  <Input list={`provs-${item.id}`} value={form.proveedor} onChange={(e) => set("proveedor", e.target.value)} />
                  <datalist id={`provs-${item.id}`}>
                    {proveedores.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Nota (opcional)">
                  <Input value={form.nota} onChange={(e) => set("nota", e.target.value)} />
                </Field>
              </div>

              <div className="rounded-md bg-slate-50 p-3 text-sm">
                <p className="mb-1 font-medium">Vista previa</p>
                {preview ? (
                  <div className="space-y-1">
                    <p className="text-slate-600">
                      Base de calculo: ${preview.base} ({withShipping ? "costo + envio" : "costo + 4%"})
                    </p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-5">
                      {(["p1", "p2", "p3", "p4", "p5"] as const).map((k, i) => (
                        <div key={k} className="tabular-nums">
                          <span className="text-slate-500">Precio {i + 1}: </span>${preview[k]}
                          {hasQty && <div className="text-xs text-slate-500">Total ${lineTotal(preview[k], item.cantidad!)}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-500">Captura el costo para ver los 5 precios.</p>
                )}
              </div>

              <Button onClick={submitQuote} disabled={pending}>
                Guardar cotizacion
              </Button>
              <p className="text-xs text-amber-800">Al guardar, la cotizacion queda bloqueada y no se podra editar.</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
