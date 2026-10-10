"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logCopyAction, markDispatchedAction } from "@/actions/requests";
import { requestUpdateAction } from "@/actions/revisions";
import { setOutcomeAction, type OutcomeInput } from "@/actions/outcomes";
import { choosePriceAction, savePdfDataAction } from "@/actions/pdf";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { ItemChat } from "@/components/item-chat";
import { ItemStatusBadge, qtyText, ReferenceList, SemaforoBadge } from "@/components/status";
import { copyRich } from "@/lib/clipboard";
import { formatPriceTable } from "@/lib/format/price-table";
import { formatDelivery, formatMinPurchase, toPriceTableItem } from "@/lib/format/quote-text";
import { computeOrder, itemCurrencies, pdfProblems, toPdfQuote } from "@/lib/pdf/model";
import { parseShippingPlan, SHIPPING_MODE_LABEL, type ShippingMode } from "@/lib/pdf/shipping";
import { lineTotal } from "@/lib/pricing/tabulador";
import { isVigenciaVencida, revisionFolio, vigenciaDiasRestantes } from "@/lib/quotes/revisions";
import {
  latestOutcome, latestQuote, LOSS_REASON_LABEL, openPause, openUpdateRequest,
  type ItemRow, type LossReason, type QuoteRow,
} from "@/lib/quotes/types";

type Pick = 1 | 2 | 3 | 4 | 5;

interface PdfPanel {
  destino: string;
  via: string;
  condiciones: string;
  atencion: string;
  envioModo: ShippingMode;
  monto: string;
  moneda: "MXN" | "USD" | "";
  partidas: Record<string, { monto: string; tipo: "unidad" | "total" }>;
}

/** Forma comparable del panel (sin montos vacios y con las partidas en orden) para saber si ya esta guardado. */
const panelKey = (p: PdfPanel) =>
  JSON.stringify({
    ...p,
    partidas: Object.entries(p.partidas)
      .filter(([, v]) => v.monto.trim() !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  });

interface Props {
  request: { id: string; folio: string; notas: string | null; cliente: string; atencion: string; destino: string; revision: number };
  items: ItemRow[];
  remainingByItem: Record<string, number | null>;
  pdfDefaults: PdfPanel;
  nowIso: string;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" });
const prices = (q: QuoteRow) => [q.price_1, q.price_2, q.price_3, q.price_4, q.price_5] as const;

export function SellerRequestView({ request, items, remainingByItem, pdfDefaults, nowIso }: Props) {
  const router = useRouter();
  const now = new Date(nowIso);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [picked, setPicked] = useState<Record<string, Pick | undefined>>(() => {
    const init: Record<string, Pick | undefined> = {};
    for (const i of items) {
      const q = latestQuote(i);
      const c = i.item_price_choice?.find((x) => x.quote_version === q?.version);
      if (c) init[i.id] = c.precio as Pick;
    }
    return init;
  });
  const [pdf, setPdf] = useState(pdfDefaults);

  const quoted = items.filter((i) => latestQuote(i));
  // Envio al cliente (opcional): va dentro del precio unitario; la vista previa usa el mismo calculo que el PDF.
  const currencies = itemCurrencies(quoted.map((i) => ({ quote: latestQuote(i) })));
  const shipParse = parseShippingPlan(
    {
      modo: pdf.envioModo, monto: pdf.monto, moneda: pdf.moneda,
      partidas: Object.entries(pdf.partidas).map(([itemId, v]) => ({ itemId, monto: v.monto, tipo: v.tipo })),
    },
    { currencies, itemIds: quoted.map((i) => i.id) },
  );
  const shippingIssue = shipParse.ok ? null : shipParse.error;
  const preview = computeOrder(
    quoted.map((i) => ({ id: i.id, cantidad: i.cantidad, precioElegido: picked[i.id] ?? null, quote: toPdfQuote(latestQuote(i)!) })),
    shipParse.ok ? shipParse.plan : undefined,
  );
  const setPartida = (id: string, patch: Partial<{ monto: string; tipo: "unidad" | "total" }>) =>
    setPdf({ ...pdf, partidas: { ...pdf.partidas, [id]: { ...(pdf.partidas[id] ?? { monto: "", tipo: "total" as const }), ...patch } } });
  const unpicked = quoted.filter((i) => !picked[i.id]).length;
  const pdfIssues = [
    ...pdfProblems(
      quoted.map((i) => ({ folio: i.folio ?? "", precioElegido: picked[i.id] ?? null, quote: latestQuote(i)! })),
      now,
    ),
    ...(shippingIssue ? [shippingIssue] : []),
  ];
  const pdfSaved = panelKey(pdf) === panelKey(pdfDefaults);

  const hasPending = items.some((i) => i.estado === "pendiente");

  async function copy(list: ItemRow[], scope: "item" | "request" | "selected", entityId: string, onlySelected = false) {
    const tableItems = list.map((i) => {
      const q = latestQuote(i)!;
      return toPriceTableItem(
        { folio: revisionFolio(i.folio!, q.version), producto: i.producto, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad, talla: i.talla },
        q,
        picked[i.id] ?? null,
      );
    });
    try {
      const mode = await copyRich(formatPriceTable(tableItems, { onlySelected }));
      setNotice({
        tone: "success",
        text: mode === "rich" ? "Copiado. Al pegar en Outlook o Word sale como tabla; en WhatsApp, como texto." : "Copiado como texto (tu navegador no permite copiar con formato).",
      });
      void logCopyAction(entityId, { scope, count: list.length }); // solo metadatos
    } catch {
      setNotice({ tone: "error", text: "No se pudo copiar. Selecciona el contenido y cópialo manualmente." });
    }
  }

  function choose(item: ItemRow, n: Pick) {
    const before = picked[item.id];
    setPicked({ ...picked, [item.id]: n });
    start(async () => {
      const r = await choosePriceAction(item.id, n);
      if (!r.ok) {
        setPicked((p) => ({ ...p, [item.id]: before }));
        setNotice({ tone: "error", text: r.error });
      }
    });
  }

  function dispatch(item: ItemRow) {
    const p = picked[item.id];
    if (!p) return;
    start(async () => {
      const r = await markDispatchedAction(item.id, p);
      if (!r.ok) setNotice({ tone: "error", text: r.error });
      else {
        setNotice({ tone: "success", text: `Registrado como enviado al cliente (${item.folio})` });
        router.refresh();
      }
    });
  }

  function downloadPdf() {
    setNotice(null);
    start(async () => {
      const saved = await savePdfDataAction({
        requestId: request.id, destino: pdf.destino, via: pdf.via, condiciones: pdf.condiciones, atencion: pdf.atencion,
        envioModo: pdf.envioModo, monto: pdf.monto, moneda: pdf.moneda,
        partidas: Object.entries(pdf.partidas).map(([itemId, v]) => ({ itemId, monto: v.monto, tipo: v.tipo })),
      });
      if (!saved.ok) {
        setNotice({ tone: "error", text: saved.error });
        return;
      }
      window.location.href = `/api/pdf/${request.id}`;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/vendedor" className="text-sm text-slate-600 hover:underline">Mis solicitudes</Link>
        <span className="text-slate-400">/</span>
        <h1 className="text-lg font-semibold">{revisionFolio(request.folio, request.revision)}</h1>
        <span className="text-sm text-slate-600">{request.cliente}</span>
      </div>
      {request.notas && <p className="text-sm text-slate-600">Notas: {request.notas}</p>}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {quoted.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => copy(quoted, "request", request.id)}>Copiar tabla de precios de toda la solicitud</Button>
        </div>
      )}

      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          requestId={request.id}
          now={now}
          remaining={remainingByItem[item.id]}
          hasPendingGlobal={hasPending}
          picked={picked[item.id]}
          pending={pending}
          onChoose={(n) => choose(item, n)}
          onDispatch={() => dispatch(item)}
          onCopy={(scope, onlySelected) => copy([item], scope, item.id, onlySelected)}
          onNotice={setNotice}
          onRefresh={() => router.refresh()}
        />
      ))}

      {quoted.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-medium">Datos del PDF para el cliente</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Destino de entrega">
              <Input value={pdf.destino} onChange={(e) => setPdf({ ...pdf, destino: e.target.value })} placeholder="Ej. Cd. Juárez, planta Pegatron" />
            </Field>
            <Field label="Vía de envío">
              <Input list="vias-envio" value={pdf.via} onChange={(e) => setPdf({ ...pdf, via: e.target.value })} />
              <datalist id="vias-envio">
                <option value="Parcel" />
                <option value="Flete" />
                <option value="Recoge cliente" />
              </datalist>
            </Field>
            <Field label="Condiciones">
              <Input list="condiciones" value={pdf.condiciones} onChange={(e) => setPdf({ ...pdf, condiciones: e.target.value })} />
              <datalist id="condiciones">
                <option value="Credito" />
                <option value="Contado" />
              </datalist>
            </Field>
            <Field label="Atención">
              <Input value={pdf.atencion} onChange={(e) => setPdf({ ...pdf, atencion: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">Envío al cliente (opcional)</p>
            <Field label="Cómo se reparte">
              <Select value={pdf.envioModo} onChange={(e) => setPdf({ ...pdf, envioModo: e.target.value as ShippingMode })} className="w-64">
                {(Object.keys(SHIPPING_MODE_LABEL) as ShippingMode[]).map((m) => (
                  <option key={m} value={m}>{SHIPPING_MODE_LABEL[m]}</option>
                ))}
              </Select>
            </Field>
            {pdf.envioModo !== "incluido" && (
              <div className="flex flex-wrap items-end gap-2">
                {pdf.envioModo !== "por_partida" && (
                  <Field label="Monto (sin IVA)">
                    <Input value={pdf.monto} onChange={(e) => setPdf({ ...pdf, monto: e.target.value })} inputMode="decimal" placeholder="0 o vacío = sin envío" className="w-44" />
                  </Field>
                )}
                {currencies.length > 1 ? (
                  <Field label="Moneda del envío">
                    <Select value={pdf.moneda} onChange={(e) => setPdf({ ...pdf, moneda: e.target.value as "MXN" | "USD" | "" })} className="w-44">
                      <option value="">Elige la moneda...</option>
                      <option value="MXN">Pesos (MXN)</option>
                      <option value="USD">Dólares (USD)</option>
                    </Select>
                  </Field>
                ) : (
                  <p className="pb-2 text-sm text-slate-600">Moneda: {currencies[0] === "USD" ? "Dólares (USD)" : "Pesos (MXN)"}</p>
                )}
              </div>
            )}
            {pdf.envioModo !== "incluido" && currencies.length > 1 && (
              <p className="text-xs text-slate-500">Solo se aplica a las partidas en la moneda elegida.</p>
            )}
            {pdf.envioModo === "por_partida" && (
              <div className="space-y-2">
                {quoted.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-end gap-2">
                    <span className="w-48 pb-2 text-sm">{i.folio} {i.producto}</span>
                    <Field label="Monto (sin IVA)">
                      <Input value={pdf.partidas[i.id]?.monto ?? ""} onChange={(e) => setPartida(i.id, { monto: e.target.value })} inputMode="decimal" placeholder="0 o vacío = sin envío" className="w-40" />
                    </Field>
                    <Field label="El monto es">
                      <Select value={pdf.partidas[i.id]?.tipo ?? "total"} onChange={(e) => setPartida(i.id, { tipo: e.target.value as "unidad" | "total" })} className="w-48">
                        <option value="unidad">por unidad</option>
                        <option value="total">total de la partida</option>
                      </Select>
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Vista previa del PDF (precios sin IVA)</p>
            {preview.perCurrency.length === 0 ? (
              <p className="text-xs text-slate-500">Elige el precio de las partidas para ver el total.</p>
            ) : (
              <>
                <table className="w-full max-w-xl text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3 font-normal">Partida</th><th className="py-1 pr-3 text-right font-normal">U. Price</th><th className="py-1 text-right font-normal">Price</th></tr>
                  </thead>
                  <tbody>
                    {quoted.filter((i) => preview.lines[i.id]).map((i) => (
                      <tr key={i.id}>
                        <td className="py-0.5 pr-3">{i.folio} {i.producto}</td>
                        <td className="py-0.5 pr-3 text-right tabular-nums">{preview.lines[i.id].precioUnitario}</td>
                        <td className="py-0.5 text-right tabular-nums">{preview.lines[i.id].importe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="w-full max-w-xl text-sm">
                  <tbody>
                    {preview.perCurrency.map((c) => (
                      <tr key={c.currency}>
                        <td className="py-1 pr-3 font-medium">Total {c.currency}</td>
                        <td className="py-1 text-right font-semibold tabular-nums">{c.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.envioIncluido && <p className="text-xs text-slate-600">Envío incluido en precios: {preview.envioIncluido}</p>}
              </>
            )}
            {unpicked > 0 && <p className="text-xs text-amber-800">Faltan {unpicked} partida(s) por elegir precio; no están en este total.</p>}
          </div>
          {pdfIssues.length > 0 && (
            <Alert tone="info">
              <ul className="list-disc pl-5">{pdfIssues.map((m) => <li key={m}>{m}</li>)}</ul>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pdfIssues.length > 0 || pending} onClick={downloadPdf}>Descargar PDF</Button>
            {!pdfSaved && <span className="text-xs text-slate-500">Se guardan los datos al descargar.</span>}
          </div>
        </Card>
      )}
      {hasPending && <p className="text-xs text-slate-500">Las partidas pendientes no aparecen en el PDF.</p>}
    </div>
  );
}

function ItemCard(props: {
  item: ItemRow;
  requestId: string;
  now: Date;
  remaining: number | null | undefined;
  hasPendingGlobal: boolean;
  picked: Pick | undefined;
  pending: boolean;
  onChoose: (n: Pick) => void;
  onDispatch: () => void;
  onCopy: (scope: "item" | "selected", onlySelected: boolean) => void;
  onNotice: (n: { tone: "success" | "error"; text: string }) => void;
  onRefresh: () => void;
}) {
  const { item, now, picked: sel } = props;
  const q = latestQuote(item);
  const d = q ? item.item_dispatch.find((x) => x.quote_version === q.version) : undefined;
  const previousDispatch = q ? item.item_dispatch.find((x) => x.quote_version < q.version) : undefined;
  const vencida = isVigenciaVencida(q, now);
  const outcome = latestOutcome(item);
  const finished = outcome?.resultado === "ganada" || outcome?.resultado === "perdida";
  const open = openUpdateRequest(item);
  const pause = openPause(item);
  const overdue = item.estado === "pendiente" && props.remaining !== null && props.remaining !== undefined && props.remaining <= 0;
  const hasQty = item.cantidad !== null && Number(item.cantidad) > 0;
  const canRequestUpdate = !!q && vencida && (item.estado === "cotizada" || item.estado === "enviada_cliente") && !finished && !open;
  const locked = !!d || item.estado !== "cotizada" || vencida;
  const versions = [...item.item_quotes].sort((a, b) => b.version - a.version);
  const requestId = props.requestId;
  const folio = q ? revisionFolio(item.folio!, q.version) : item.folio;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">{folio}</p>
          <h2 className="font-medium">{item.producto}</h2>
          <p className="text-sm text-slate-600">{item.descripcion}</p>
          <p className="mt-1 text-sm">{qtyText(item.cantidad, item.unidad, item.talla)}</p>
          {item.notas && <p className="text-xs text-slate-500">Notas: {item.notas}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vencida && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Vigencia vencida</span>}
          <ItemStatusBadge estado={item.estado} vencida={overdue} />
          {item.estado === "pendiente" && props.remaining !== null && props.remaining !== undefined && <SemaforoBadge remaining={props.remaining} />}
        </div>
      </div>
      <ReferenceList refs={item.item_references} />

      {item.estado === "no_encontrada" && <Alert tone="info"><strong>No encontrada:</strong> {item.not_found_note}</Alert>}
      {pause && <Alert tone="info">El comprador espera una aclaración tuya. Abre "Aclaraciones y mensajes" para responder.</Alert>}
      {item.estado === "actualizacion_solicitada" && open && (
        <Alert tone="info">
          Actualización solicitada el {fmtDate(open.requested_at)}. El comprador tiene 48 horas hábiles para responder.
        </Alert>
      )}
      {previousDispatch && !d && item.estado === "cotizada" && (
        <Alert tone="success">
          Hay una versión nueva (v{q!.version}) de esta cotización. Vuelve a elegir el precio y marca "Enviado al cliente" otra vez.
        </Alert>
      )}

      {q && (
        <div className="space-y-3">
          <div className="grid gap-1 text-sm sm:grid-cols-4">
            <p><span className="text-slate-500">Moneda:</span> {q.moneda}</p>
            <p><span className="text-slate-500">Entrega:</span> {formatDelivery(q)}</p>
            <p><span className="text-slate-500">Compra mínima:</span> {formatMinPurchase(q) ?? "Sin mínimo"}</p>
            <p>
              <span className="text-slate-500">Vigencia:</span>{" "}
              {q.valid_until ? (vencida ? <span className="font-medium text-red-700">vencida el {fmtDate(q.valid_until)}</span> : `hasta ${fmtDate(q.valid_until)} (${vigenciaDiasRestantes(q, now)} días)`) : "-"}
            </p>
          </div>
          {q.nota && <p className="text-sm text-slate-600">Nota del comprador: {q.nota}</p>}

          <table className="w-full max-w-xl text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2" />
                <th className="py-1 pr-2">Precio</th>
                <th className="py-1 pr-2 text-right">Unitario</th>
                {hasQty && <th className="py-1 text-right">Total</th>}
              </tr>
            </thead>
            <tbody>
              {prices(q).map((p, idx) => {
                const n = (idx + 1) as Pick;
                return (
                  <tr key={n} className={sel === n ? "bg-brand-50" : ""}>
                    <td className="py-1 pr-2">
                      <input type="radio" name={`precio-${item.id}`} checked={sel === n} disabled={locked || props.pending} onChange={() => props.onChoose(n)} aria-label={`Elegir precio ${n}`} />
                    </td>
                    <td className="py-1 pr-2">Precio {n}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">${Number(p).toFixed(2)} {q.moneda}</td>
                    {hasQty && <td className="py-1 text-right tabular-nums">${lineTotal(Number(p).toFixed(2), item.cantidad!)} {q.moneda}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs font-medium text-slate-600">Precios sin IVA</p>
          {d && <p className="text-xs text-slate-500">El precio ya se envió al cliente y quedó fijo para esta versión.</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => props.onCopy("item", false)}>Copiar tabla de precios</Button>
            <Button variant="secondary" disabled={!sel} onClick={() => props.onCopy("selected", true)}>Copiar solo el precio elegido</Button>
            {item.estado === "cotizada" && !vencida && (
              <Button disabled={!sel || props.pending} onClick={props.onDispatch}>Enviado al cliente</Button>
            )}
            {item.estado === "cotizada" && !sel && !vencida && <span className="text-xs text-amber-800">Elige el precio que pasaste al cliente.</span>}
            {d && (
              <span className="text-sm text-slate-600">
                Enviado al cliente: Precio {d.precio_elegido} (${Number(d.valor).toFixed(2)} {q.moneda}) el{" "}
                {new Date(d.enviado_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            )}
          </div>

          {canRequestUpdate && <RequestUpdate itemId={item.id} onNotice={props.onNotice} onRefresh={props.onRefresh} />}
          {vencida && !canRequestUpdate && finished && <p className="text-xs text-slate-500">La cotización ya tiene resultado, por eso no se puede pedir actualización.</p>}
          {d && <OutcomeForm itemId={item.id} cantidadSolicitada={item.cantidad} onNotice={props.onNotice} onRefresh={props.onRefresh} outcome={outcome} />}

          {versions.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Versiones anteriores ({versions.length - 1})</summary>
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {versions.slice(1).map((v) => (
                  <li key={v.version}>
                    v{v.version} ({fmtDate(v.quoted_at)}, {v.moneda}): {prices(v).map((p, i) => `P${i + 1} $${Number(p).toFixed(2)}`).join(" · ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <ItemChat itemId={item.id} requestId={requestId} me="vendedor" messages={item.item_messages ?? []} waitingForSeller={!!pause} />
    </Card>
  );
}

function RequestUpdate({ itemId, onNotice, onRefresh }: { itemId: string; onNotice: (n: { tone: "success" | "error"; text: string }) => void; onRefresh: () => void }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [nota, setNota] = useState("");
  if (!open) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm">
        <span className="text-red-800">La vigencia de esta cotización venció.</span>
        <Button onClick={() => setOpen(true)}>Solicitar actualización</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
      <Field label="Nota para el comprador (opcional)">
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </Field>
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await requestUpdateAction(itemId, nota);
              if (!r.ok) onNotice({ tone: "error", text: r.error });
              else {
                onNotice({ tone: "success", text: "Actualización solicitada. El comprador tiene 48 horas hábiles para responder." });
                onRefresh();
              }
            })
          }
        >
          Enviar solicitud
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </div>
  );
}

function OutcomeForm({
  itemId, cantidadSolicitada, outcome, onNotice, onRefresh,
}: {
  itemId: string;
  cantidadSolicitada: number | string | null;
  outcome: ReturnType<typeof latestOutcome>;
  onNotice: (n: { tone: "success" | "error"; text: string }) => void;
  onRefresh: () => void;
}) {
  const [pending, start] = useTransition();
  const [v, setV] = useState<OutcomeInput>({
    resultado: outcome?.resultado ?? "sin_respuesta",
    motivo: (outcome?.motivo as LossReason | null) ?? undefined,
    motivo_texto: outcome?.motivo_texto ?? "",
    cantidad_final: outcome?.cantidad_final ? String(Number(outcome.cantidad_final)) : "",
  });
  return (
    <div className="space-y-2 rounded-md bg-slate-50 p-3">
      <p className="text-sm font-medium">Resultado de la cotización</p>
      <div className="flex flex-wrap gap-4 text-sm">
        {([["sin_respuesta", "Sin respuesta"], ["ganada", "Ganada"], ["perdida", "Perdida"]] as const).map(([val, label]) => (
          <label key={val} className="flex items-center gap-1">
            <input type="radio" name={`res-${itemId}`} checked={v.resultado === val} onChange={() => setV({ ...v, resultado: val })} /> {label}
          </label>
        ))}
      </div>
      {v.resultado === "perdida" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Motivo (obligatorio)">
            <Select value={v.motivo ?? ""} onChange={(e) => setV({ ...v, motivo: (e.target.value || undefined) as LossReason | undefined })}>
              <option value="">Elige un motivo...</option>
              {(Object.keys(LOSS_REASON_LABEL) as LossReason[]).map((k) => <option key={k} value={k}>{LOSS_REASON_LABEL[k]}</option>)}
            </Select>
          </Field>
          {v.motivo === "otro" && (
            <Field label="Describe el motivo">
              <Input value={v.motivo_texto ?? ""} onChange={(e) => setV({ ...v, motivo_texto: e.target.value })} />
            </Field>
          )}
        </div>
      )}
      {v.resultado === "ganada" && (
        <Field label={`Cantidad final (opcional; solicitada: ${cantidadSolicitada ? Number(cantidadSolicitada) : "-"})`}>
          <Input value={v.cantidad_final ?? ""} onChange={(e) => setV({ ...v, cantidad_final: e.target.value })} inputMode="decimal" className="max-w-xs" />
        </Field>
      )}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setOutcomeAction(itemId, v);
            if (!r.ok) onNotice({ tone: "error", text: r.error });
            else {
              onNotice({ tone: "success", text: "Resultado guardado" });
              onRefresh();
            }
          })
        }
      >
        Guardar resultado
      </Button>
    </div>
  );
}
