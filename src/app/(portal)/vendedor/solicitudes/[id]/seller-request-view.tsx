"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { logCopyAction } from "@/actions/requests";
import { requestUpdateAction } from "@/actions/revisions";
import { setOutcomeAction, type OutcomeInput } from "@/actions/outcomes";
import { choosePriceAction, savePdfDataAction } from "@/actions/pdf";
import { cancelRenegotiationAction, issueQuoteAction, openRenegotiationAction, registerSendAction, type SendMedium } from "@/actions/emissions";
import { Icon } from "@/components/icons";
import { IssuesList } from "@/components/issues-list";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { ItemChat } from "@/components/item-chat";
import { ItemStatusBadge, qtyText, ReferenceList, SemaforoBadge } from "@/components/status";
import { copyRich } from "@/lib/clipboard";
import { formatPriceTable } from "@/lib/format/price-table";
import { formatDelivery, toPriceTableItem } from "@/lib/format/quote-text";
import { whatsappNumber } from "@/lib/leads/types";
import { describeMin, MIN_DECISION_LABEL, minAlert, type MinDecision } from "@/lib/quotes/min-purchase";
import { computeOrder, itemCurrencies, pdfProblems, toPdfQuote } from "@/lib/pdf/model";
import {
  DISTRIBUTION_LABEL,
  parseShippingSetup,
  PRESENTATION_HINT,
  PRESENTATION_LABEL,
  type DistributionMode,
  type ShippingMode,
  type ShippingPresentation,
} from "@/lib/pdf/shipping";
import { lineTotal } from "@/lib/pricing/tabulador";
import { isVigenciaVencida, revisionFolio, vigenciaDiasRestantes } from "@/lib/quotes/revisions";
import { SEND_MEDIUM_LABEL } from "@/lib/stats/timeline";
import {
  latestOutcome, latestQuote, LOSS_REASON_LABEL, openPause, openUpdateRequest,
  type ItemRow, type LossReason, type QuoteRow,
} from "@/lib/quotes/types";

type Pick = 1 | 2 | 3 | 4 | 5;
type Notice = { tone: "success" | "error" | "info"; text: string; list?: string[] } | null;

interface PdfPanel {
  destino: string;
  via: string;
  condiciones: string;
  atencion: string;
  presentacion: ShippingPresentation;
  envioModo: ShippingMode;
  monto: string;
  aparteMonto: string;
  moneda: "MXN" | "USD" | "";
  partidas: Record<string, { monto: string; tipo: "unidad" | "total" }>;
  /** "Nombre en el PDF" por partida (precargado con el guardado, el alternativo o el producto). */
  nombres: Record<string, string>;
  /** Decision por partida con cantidad pedida menor al minimo (por revision). */
  minimos: Record<string, MinDecision>;
}

export interface IssueView {
  id: string;
  numero: string;
  revision: number;
  emitidaAt: string;
  totals: { currency: string; amount: string }[];
  motivo: string | null;
  sends: { id: string; medio: string; destinatario: string | null; nota: string | null; enviado_at: string }[];
}

interface CustomerInfo {
  id: string;
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  direccion: string | null;
  contacto_nombre: string | null;
  contacto_correo: string | null;
  contacto_telefono: string | null;
}

interface Props {
  request: { id: string; folio: string; notas: string | null; cliente: string; atencion: string; destino: string; revision: number; vendedor: string };
  customer: CustomerInfo | null;
  items: ItemRow[];
  remainingByItem: Record<string, number | null>;
  pdfDefaults: PdfPanel;
  nombreDefecto: Record<string, string>;
  emission: { canIssue: boolean; nextNumero: string; unsent: number; renegotiation: { motivo: string; abiertaAt: string } | null };
  issues: IssueView[];
  nowIso: string;
}

/** Forma comparable del panel (sin montos vacios y con las partidas en orden) para saber si ya esta guardado. */
const panelKey = (p: PdfPanel) =>
  JSON.stringify({
    ...p,
    partidas: Object.entries(p.partidas)
      .filter(([, v]) => v.monto.trim() !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
    minimos: Object.entries(p.minimos).sort(([a], [b]) => a.localeCompare(b)),
  });

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
const prices = (q: QuoteRow) => [q.price_1, q.price_2, q.price_3, q.price_4, q.price_5] as const;
const totalsText = (t: { currency: string; amount: string }[]) => t.map((x) => `${x.amount} ${x.currency}`).join(" + ");

const MEDIA: { id: SendMedium; label: string; icon: "mail" | "chat" | "users" | "phone" | "more" }[] = [
  { id: "correo", label: "Correo", icon: "mail" },
  { id: "whatsapp", label: "WhatsApp", icon: "chat" },
  { id: "en_persona", label: "En persona", icon: "users" },
  { id: "telefono", label: "Teléfono", icon: "phone" },
  { id: "otro", label: "Otro", icon: "more" },
];

function messageText(numero: string, contacto: string | null, vendedor: string, totals: string) {
  const saludo = contacto ? `Buen día ${contacto.split(" ")[0]},` : "Buen día,";
  return `${saludo}\n\nLe comparto la cotización ${numero} de ESC Representaciones${totals ? ` (total ${totals}, precios sin IVA)` : ""}.\n\nQuedo atento a sus comentarios.\n\n${vendedor}\nESC Representaciones`;
}

export function SellerRequestView({ request, customer, items, remainingByItem, pdfDefaults, nombreDefecto, emission, issues, nowIso }: Props) {
  const router = useRouter();
  const now = new Date(nowIso);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
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
  useEffect(() => setPdf(pdfDefaults), [pdfDefaults]);
  const nombrePdf = (i: ItemRow) => pdf.nombres[i.id]?.trim() || nombreDefecto[i.id] || i.producto;

  const renegOpen = !!emission.renegotiation;
  const editable = emission.canIssue;
  const lastIssue = issues[0] ?? null;
  const quoted = items.filter((i) => latestQuote(i));
  const waitingBuyer = items.filter((i) => ["pendiente", "actualizacion_solicitada", "esperando_aclaracion"].includes(i.estado));
  const currencies = itemCurrencies(quoted.map((i) => ({ quote: latestQuote(i) })));
  const ship = parseShippingSetup(
    {
      presentacion: pdf.presentacion, modo: pdf.envioModo, monto: pdf.monto, moneda: pdf.moneda, aparteMonto: pdf.aparteMonto,
      partidas: Object.entries(pdf.partidas).map(([itemId, v]) => ({ itemId, monto: v.monto, tipo: v.tipo })),
    },
    { currencies, itemIds: quoted.map((i) => i.id) },
  );
  const preview = computeOrder(
    quoted.map((i) => ({ id: i.id, cantidad: i.cantidad, unidad: i.unidad, precioElegido: picked[i.id] ?? null, quote: toPdfQuote(latestQuote(i)!), decisionMin: pdf.minimos[i.id] })),
    ship.ok ? ship.plan : undefined,
    ship.ok ? ship.aparte : null,
  );
  const alertItems = quoted.filter((i) => minAlert(i, latestQuote(i)!));
  const unpicked = quoted.filter((i) => !picked[i.id]).length;
  const pdfIssues = [
    ...pdfProblems(
      quoted.map((i) => ({ folio: i.folio ?? "", precioElegido: picked[i.id] ?? null, quote: latestQuote(i)!, cantidad: i.cantidad, unidad: i.unidad, decisionMin: pdf.minimos[i.id] })),
      now,
    ),
    ...(ship.ok ? [] : [ship.error]),
  ];
  const pdfSaved = panelKey(pdf) === panelKey(pdfDefaults);
  const previewTotals = preview.perCurrency.map((c) => ({ currency: c.currency, amount: c.total }));

  const contactName = pdf.atencion || customer?.contacto_nombre || null;
  const email = customer?.contacto_correo ?? null;
  const wa = whatsappNumber(customer?.contacto_telefono ?? null);

  function savePdf() {
    return savePdfDataAction({
      requestId: request.id, destino: pdf.destino, via: pdf.via, condiciones: pdf.condiciones, atencion: pdf.atencion,
      presentacion: pdf.presentacion, envioModo: pdf.envioModo, monto: pdf.monto, aparteMonto: pdf.aparteMonto, moneda: pdf.moneda,
      partidas: Object.entries(pdf.partidas).map(([itemId, v]) => ({ itemId, monto: v.monto, tipo: v.tipo })),
      minimos: alertItems.flatMap((i) => (pdf.minimos[i.id] ? [{ itemId: i.id, decision: pdf.minimos[i.id] }] : [])),
      // Solo se guardan los nombres editados; igual al nombre por defecto (o vacio) = volver al default.
      nombres: quoted.map((i) => {
        const n = (pdf.nombres[i.id] ?? "").trim();
        return { itemId: i.id, nombre: n && n !== nombreDefecto[i.id] ? n : "" };
      }),
    });
  }

  function run(key: string, fn: () => Promise<void>) {
    setNotice(null);
    setBusy(key);
    start(async () => {
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  }

  /** Descarga el PDF: si hay algo por enviar, primero guarda los datos del panel. */
  function downloadPdf(issueId?: string) {
    run("download", async () => {
      if (!issueId && editable && !pdfSaved) {
        const saved = await savePdf();
        if (!saved.ok) return setNotice({ tone: "error", text: saved.error });
      }
      window.location.href = `/api/pdf/${request.id}${issueId ? `?emision=${issueId}` : ""}`;
    });
  }

  /** En celular: comparte el PDF directo a WhatsApp, correo, etc. */
  async function sharePdf(numero: string, issueId?: string) {
    run("share", async () => {
      if (!issueId && editable && !pdfSaved) {
        const saved = await savePdf();
        if (!saved.ok) return setNotice({ tone: "error", text: saved.error });
      }
      const res = await fetch(`/api/pdf/${request.id}${issueId ? `?emision=${issueId}` : ""}`);
      if (!res.ok) return setNotice({ tone: "error", text: "No se pudo generar el PDF" });
      const file = new File([await res.blob()], `${numero}.pdf`, { type: "application/pdf" });
      try {
        await navigator.share({ files: [file], title: `Cotización ${numero}`, text: messageText(numero, contactName, request.vendedor, "") });
      } catch {
        /* el usuario cancelo */
      }
    });
  }

  function issue(medio: SendMedium, destinatario: string, nota: string) {
    run("issue", async () => {
      const saved = await savePdf();
      if (!saved.ok) return setNotice({ tone: "error", text: saved.error });
      const r = await issueQuoteAction(request.id, { medio, destinatario, nota });
      if (!r.ok) return setNotice({ tone: "error", text: r.error, list: r.problems });
      setNotice({ tone: "success", text: `Listo: la cotización ${r.numero} quedó registrada como enviada por ${SEND_MEDIUM_LABEL[medio]}.` });
      router.refresh();
    });
  }

  async function copy(list: ItemRow[], scope: "item" | "request" | "selected", entityId: string, onlySelected = false) {
    const tableItems = list.map((i) => {
      const q = latestQuote(i)!;
      return toPriceTableItem({ folio: revisionFolio(i.folio!, q.version), producto: nombrePdf(i), cantidad: i.cantidad, unidad: i.unidad, talla: i.talla }, q, picked[i.id] ?? null);
    });
    try {
      const mode = await copyRich(formatPriceTable(tableItems, { onlySelected }));
      setNotice({ tone: "success", text: mode === "rich" ? "Copiado. Al pegar en Outlook o Word sale como tabla; en WhatsApp, como texto." : "Copiado como texto (tu navegador no permite copiar con formato)." });
      void logCopyAction(entityId, { scope, count: list.length });
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

  // ---- Etapa y siguiente paso ------------------------------------------------
  const dispatchedItems = items.filter((i) => i.item_dispatch.length > 0);
  const finished = dispatchedItems.length > 0 && dispatchedItems.every((i) => ["ganada", "perdida"].includes(latestOutcome(i)?.resultado ?? ""));
  const sentOnce = issues.length > 0 || dispatchedItems.length > 0;
  const steps = [
    { label: "Solicitada", state: "done" as const },
    { label: "Cotizada por compras", state: quoted.length === 0 ? "current" : waitingBuyer.length ? "partial" : "done" },
    { label: "Enviada al cliente", state: !quoted.length ? "todo" : editable ? "current" : "done" },
    { label: "Resultado", state: finished ? "done" : sentOnce && !editable ? "current" : "todo" },
  ] as const;

  let next: { tone: string; title: string; body: string } | null = null;
  if (renegOpen) next = { tone: "amber", title: "Recotización abierta", body: `Motivo: ${emission.renegotiation!.motivo}. Elige otros precios o cambia el envío y registra el envío: saldrá como ${emission.nextNumero}.` };
  else if (editable && quoted.length) next = { tone: "amber", title: "Lista para enviar al cliente", body: `Elige el precio de cada partida, revisa el PDF y regístrala como enviada. Saldrá como ${emission.nextNumero}.` };
  else if (items.some((i) => i.estado === "esperando_aclaracion")) next = { tone: "purple", title: "Compras espera tu aclaración", body: "Abre \"Aclaraciones y mensajes\" en la partida marcada." };
  else if (waitingBuyer.length && !quoted.length) next = { tone: "brand", title: "Compras está cotizando", body: `${waitingBuyer.length} partida(s) en espera de precio.` };
  else if (finished) next = { tone: "green", title: "Cotización cerrada", body: "Todas las partidas enviadas tienen resultado." };
  else if (lastIssue) next = { tone: "indigo", title: `Enviada al cliente: ${lastIssue.numero}`, body: "Marca el resultado de cada partida cuando el cliente responda. Si pide mejor precio, usa Recotizar." };
  const toneCls: Record<string, string> = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    purple: "border-purple-300 bg-purple-50 text-purple-900",
    brand: "border-brand-100 bg-brand-50 text-brand-900",
    green: "border-green-200 bg-green-50 text-green-900",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link href="/vendedor" className="text-sm text-slate-500 hover:text-slate-800">← Mis solicitudes</Link>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{revisionFolio(request.folio, request.revision)}</h1>
          <span className="text-slate-600">{request.cliente}</span>
        </div>
        {request.notas && <p className="text-sm text-slate-600">Notas: {request.notas}</p>}
      </div>

      <Stepper steps={steps} />

      {next && (
        <div className={`rounded-lg border px-4 py-3 ${toneCls[next.tone]}`}>
          <p className="text-sm font-semibold">{next.title}</p>
          <p className="text-sm opacity-90">{next.body}</p>
        </div>
      )}

      {notice && (
        <Alert tone={notice.tone}>
          {notice.text}
          {notice.list && notice.list.length > 1 && <ul className="mt-1 list-disc pl-5">{notice.list.map((m) => <li key={m}>{m}</li>)}</ul>}
        </Alert>
      )}

      <CustomerCard customer={customer} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Partidas ({items.length})</h2>
          {quoted.length > 0 && (
            <Button variant="secondary" className="text-xs" onClick={() => copy(quoted, "request", request.id)}>Copiar tabla de precios</Button>
          )}
        </div>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            requestId={request.id}
            now={now}
            remaining={remainingByItem[item.id]}
            picked={picked[item.id]}
            pending={pending}
            renegOpen={renegOpen}
            onChoose={(n) => choose(item, n)}
            onCopy={(scope, onlySelected) => copy([item], scope, item.id, onlySelected)}
            onNotice={setNotice}
            onRefresh={() => router.refresh()}
            onUseAltName={(name) => setPdf((p) => ({ ...p, nombres: { ...p.nombres, [item.id]: name } }))}
          />
        ))}
      </section>

      {quoted.length > 0 && editable && (
        <Card className="space-y-5 border-2 border-amber-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Cotización para el cliente</h2>
              <p className="text-sm text-slate-500">
                Saldrá como <strong className="text-slate-900">{emission.nextNumero}</strong>
                {lastIssue && <> (la anterior, {lastIssue.numero}, se conserva igual)</>}
              </p>
            </div>
            {renegOpen && (
              <Button variant="ghost" className="text-red-700" loading={busy === "cancel"} onClick={() => run("cancel", async () => {
                const r = await cancelRenegotiationAction(request.id);
                if (!r.ok) return setNotice({ tone: "error", text: r.error });
                setNotice({ tone: "success", text: "Recotización cancelada: se conservan los precios ya enviados." });
                router.refresh();
              })}>
                Cancelar recotización
              </Button>
            )}
          </div>

          <PdfDataFields pdf={pdf} setPdf={setPdf} />

          {alertItems.length > 0 && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">Cantidad pedida menor a la compra mínima</p>
              {alertItems.map((i) => (
                <div key={i.id} className="space-y-1 text-sm">
                  <p>{i.folio} {i.producto}: {minAlert(i, latestQuote(i)!)!.text}</p>
                  <div className="flex flex-wrap gap-4">
                    {(Object.keys(MIN_DECISION_LABEL) as MinDecision[]).map((d) => (
                      <label key={d} className="flex items-center gap-1">
                        <input type="radio" name={`min-${i.id}`} checked={pdf.minimos[i.id] === d} onChange={() => setPdf({ ...pdf, minimos: { ...pdf.minimos, [i.id]: d } })} />
                        {MIN_DECISION_LABEL[d]}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <ShippingFields pdf={pdf} setPdf={setPdf} quoted={quoted} currencies={currencies} />

          <details className="rounded-md border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Nombre de cada producto en el PDF</summary>
            <p className="mt-1 text-xs text-slate-500">Es lo único que ve el cliente en "Product Name". La descripción y el uso son internos.</p>
            <div className="mt-2 space-y-2">
              {quoted.map((i) => (
                <Field key={i.id} label={`${i.folio} (solicitado: ${i.producto})`}>
                  <Input value={pdf.nombres[i.id] ?? ""} maxLength={200} placeholder={nombreDefecto[i.id] ?? i.producto} onChange={(e) => setPdf({ ...pdf, nombres: { ...pdf.nombres, [i.id]: e.target.value } })} />
                </Field>
              ))}
            </div>
          </details>

          <Preview quoted={quoted} preview={preview} nombre={nombrePdf} unpicked={unpicked} />

          {pdfIssues.length > 0 && (
            <Alert tone="info">
              <p className="font-medium">Para enviar falta:</p>
              <ul className="list-disc pl-5">{pdfIssues.map((m) => <li key={m}>{m}</li>)}</ul>
            </Alert>
          )}

          <SendFlow
            numero={emission.nextNumero}
            disabled={pdfIssues.length > 0 || pending}
            busy={busy}
            email={email}
            wa={wa}
            text={messageText(emission.nextNumero, contactName, request.vendedor, totalsText(previewTotals))}
            onDownload={() => downloadPdf()}
            onShare={() => sharePdf(emission.nextNumero)}
            submitLabel="Registrar como enviada"
            onSubmit={issue}
          />
        </Card>
      )}

      {quoted.length > 0 && !editable && lastIssue && (
        <SentCard
          issue={lastIssue}
          busy={busy}
          email={email}
          wa={wa}
          text={messageText(lastIssue.numero, contactName, request.vendedor, totalsText(lastIssue.totals))}
          onDownload={() => downloadPdf(lastIssue.id)}
          onShare={() => sharePdf(lastIssue.numero, lastIssue.id)}
          onResend={(medio, destinatario, nota) => run("issue", async () => {
            const r = await registerSendAction(request.id, lastIssue.id, { medio, destinatario, nota });
            if (!r.ok) return setNotice({ tone: "error", text: r.error });
            setNotice({ tone: "success", text: `Envío registrado: ${lastIssue.numero} por ${SEND_MEDIUM_LABEL[medio]}.` });
            router.refresh();
          })}
          onRenegotiate={(motivo) => run("reneg", async () => {
            const r = await openRenegotiationAction(request.id, motivo);
            if (!r.ok) return setNotice({ tone: "error", text: r.error });
            setNotice({ tone: "info", text: "Recotización abierta. Elige los nuevos precios y registra el envío para generar el número nuevo." });
            router.refresh();
          })}
        />
      )}

      {quoted.length > 0 && !editable && !lastIssue && (
        <Alert tone="info">Las partidas se marcaron como enviadas una por una (antes de los números de cotización). Para cambiar precios, primero registra la cotización como enviada.</Alert>
      )}

      <IssuesList issues={issues.map((x) => ({ ...x, emitida_at: x.emitidaAt }))} requestId={request.id} />
      {waitingBuyer.length > 0 && quoted.length > 0 && <p className="text-xs text-slate-500">Las partidas que aún cotiza compras no aparecen en el PDF; cuando estén listas podrás enviarlas con un número nuevo.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stepper({ steps }: { steps: readonly { label: string; state: "done" | "current" | "partial" | "todo" }[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1 sm:gap-2">
      {steps.map((s, i) => {
        const cls =
          s.state === "done" ? "bg-green-600 text-white" : s.state === "current" ? "bg-amber-500 text-white" : s.state === "partial" ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500";
        return (
          <li key={s.label} className="space-y-1">
            <div className={`h-1.5 rounded-full ${s.state === "todo" ? "bg-slate-200" : s.state === "done" ? "bg-green-600" : s.state === "partial" ? "bg-brand-600" : "bg-amber-500"}`} />
            <div className="flex items-center gap-1.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${cls}`}>{s.state === "done" ? "✓" : i + 1}</span>
              <span className={`text-xs leading-tight ${s.state === "todo" ? "text-slate-400" : "font-medium text-slate-700"}`}>{s.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CustomerCard({ customer }: { customer: CustomerInfo | null }) {
  if (!customer) return null;
  const missing = [!customer.rfc && "RFC", !customer.direccion && "dirección", !customer.contacto_telefono && !customer.contacto_correo && "teléfono o correo"].filter(Boolean);
  return (
    <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="font-medium text-slate-900">
          {customer.nombre}
          {customer.rfc && <span className="ml-2 font-mono text-xs text-slate-500">{customer.rfc}</span>}
        </p>
        <p className="text-slate-600">{[customer.contacto_nombre, customer.contacto_telefono, customer.contacto_correo].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
        {missing.length > 0 && <p className="text-xs text-amber-800">Falta: {missing.join(", ")}</p>}
      </div>
      <Link href={`/vendedor/clientes?editar=${customer.id}`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline">
        {missing.length ? "Completar datos" : "Ver cliente"}
      </Link>
    </Card>
  );
}

function PdfDataFields({ pdf, setPdf }: { pdf: PdfPanel; setPdf: (p: PdfPanel) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Atención (persona de contacto)">
        <Input value={pdf.atencion} onChange={(e) => setPdf({ ...pdf, atencion: e.target.value })} />
      </Field>
      <Field label="Condiciones">
        <Input list="condiciones" value={pdf.condiciones} onChange={(e) => setPdf({ ...pdf, condiciones: e.target.value })} />
        <datalist id="condiciones"><option value="Credito" /><option value="Contado" /></datalist>
      </Field>
      <Field label="Destino de entrega">
        <Input value={pdf.destino} onChange={(e) => setPdf({ ...pdf, destino: e.target.value })} placeholder="Ej. Cd. Juárez, planta Pegatron" />
      </Field>
      <Field label="Vía de envío">
        <Input list="vias-envio" value={pdf.via} onChange={(e) => setPdf({ ...pdf, via: e.target.value })} />
        <datalist id="vias-envio"><option value="Parcel" /><option value="Flete" /><option value="Recoge cliente" /></datalist>
      </Field>
    </div>
  );
}

function ShippingFields({ pdf, setPdf, quoted, currencies }: { pdf: PdfPanel; setPdf: (p: PdfPanel) => void; quoted: ItemRow[]; currencies: ("MXN" | "USD")[] }) {
  const p = pdf.presentacion;
  const dist: DistributionMode = pdf.envioModo === "incluido" ? "por_pedido" : pdf.envioModo;
  const showIncluded = p === "incluido" || p === "mixto";
  const showAparte = p === "aparte" || p === "mixto";
  const setPartida = (id: string, patch: Partial<{ monto: string; tipo: "unidad" | "total" }>) =>
    setPdf({ ...pdf, partidas: { ...pdf.partidas, [id]: { ...(pdf.partidas[id] ?? { monto: "", tipo: "total" as const }), ...patch } } });
  const n = (v: string) => Number(v.replace(/,/g, "")) || 0;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">¿Cómo ve el cliente el envío?</p>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {(Object.keys(PRESENTATION_LABEL) as ShippingPresentation[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setPdf({ ...pdf, presentacion: k, envioModo: k === "incluido" || k === "mixto" ? dist : "incluido" })}
            className={`rounded-lg border p-2.5 text-left transition ${p === k ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-400"}`}
          >
            <span className="block text-sm font-medium text-slate-900">{PRESENTATION_LABEL[k]}</span>
            <span className="block text-xs leading-snug text-slate-500">{PRESENTATION_HINT[k]}</span>
          </button>
        ))}
      </div>

      {(showIncluded || showAparte) && (
        <div className="space-y-3 rounded-md bg-slate-50 p-3">
          {currencies.length > 1 && (
            <Field label="Moneda del envío">
              <Select value={pdf.moneda} onChange={(e) => setPdf({ ...pdf, moneda: e.target.value as "MXN" | "USD" | "" })} className="sm:w-56">
                <option value="">Elige la moneda...</option>
                <option value="MXN">Pesos (MXN)</option>
                <option value="USD">Dólares (USD)</option>
              </Select>
            </Field>
          )}
          {showIncluded && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <Field label={p === "mixto" ? "Parte incluida en los precios" : "Cómo se reparte"}>
                  <Select value={dist} onChange={(e) => setPdf({ ...pdf, envioModo: e.target.value as DistributionMode })} className="sm:w-60">
                    {(Object.keys(DISTRIBUTION_LABEL) as DistributionMode[]).map((m) => <option key={m} value={m}>{DISTRIBUTION_LABEL[m]}</option>)}
                  </Select>
                </Field>
                {dist !== "por_partida" && (
                  <Field label={dist === "por_unidad" ? "Monto por unidad (sin IVA)" : "Monto incluido (sin IVA)"}>
                    <Input value={pdf.monto} onChange={(e) => setPdf({ ...pdf, monto: e.target.value })} inputMode="decimal" placeholder="0.00" className="sm:w-40" />
                  </Field>
                )}
              </div>
              {dist === "por_partida" &&
                quoted.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-end gap-2">
                    <span className="w-full pb-1 text-sm sm:w-48 sm:pb-2">{i.folio} {i.producto}</span>
                    <Field label="Monto (sin IVA)">
                      <Input value={pdf.partidas[i.id]?.monto ?? ""} onChange={(e) => setPartida(i.id, { monto: e.target.value })} inputMode="decimal" placeholder="0.00" className="w-32" />
                    </Field>
                    <Field label="El monto es">
                      <Select value={pdf.partidas[i.id]?.tipo ?? "total"} onChange={(e) => setPartida(i.id, { tipo: e.target.value as "unidad" | "total" })} className="w-44">
                        <option value="unidad">por unidad</option>
                        <option value="total">total de la partida</option>
                      </Select>
                    </Field>
                  </div>
                ))}
            </div>
          )}
          {showAparte && (
            <Field label={p === "mixto" ? "Parte como renglón \"Envío\" (sin IVA)" : "Monto del envío (sin IVA)"}>
              <Input value={pdf.aparteMonto} onChange={(e) => setPdf({ ...pdf, aparteMonto: e.target.value })} inputMode="decimal" placeholder="0.00" className="sm:w-40" />
            </Field>
          )}
          {p === "mixto" && dist !== "por_partida" && n(pdf.monto) + n(pdf.aparteMonto) > 0 && (
            <p className="text-xs text-slate-600">
              Envío total: ${(n(pdf.monto) + n(pdf.aparteMonto)).toFixed(2)} (incluido ${n(pdf.monto).toFixed(2)} + aparte ${n(pdf.aparteMonto).toFixed(2)})
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Preview({ quoted, preview, nombre, unpicked }: { quoted: ItemRow[]; preview: ReturnType<typeof computeOrder>; nombre: (i: ItemRow) => string; unpicked: number }) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <p className="text-sm font-medium text-slate-700">Así lo verá el cliente (precios sin IVA)</p>
      {preview.perCurrency.length === 0 ? (
        <p className="text-xs text-slate-500">Elige el precio de las partidas para ver el total.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3 font-normal">Producto</th><th className="py-1 pr-3 text-right font-normal">U. Price</th><th className="py-1 text-right font-normal">Price</th></tr>
            </thead>
            <tbody>
              {quoted.filter((i) => preview.lines[i.id]).map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{nombre(i)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{preview.lines[i.id].precioUnitario}</td>
                  <td className="py-1 text-right tabular-nums">{preview.lines[i.id].importe}</td>
                </tr>
              ))}
              {preview.envioAparte && (
                <tr className="border-t border-slate-100 text-slate-700">
                  <td className="py-1 pr-3">Envío / Shipping</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{preview.envioAparte.amount}</td>
                  <td className="py-1 text-right tabular-nums">{preview.envioAparte.amount}</td>
                </tr>
              )}
              {preview.perCurrency.map((c) => (
                <tr key={c.currency} className="border-t-2 border-slate-200">
                  <td className="py-1.5 pr-3 font-semibold" colSpan={2}>Total {c.currency}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview.envioIncluido && <p className="text-xs text-slate-600">Envío incluido dentro de los precios: {preview.envioIncluido}</p>}
      {unpicked > 0 && <p className="text-xs text-amber-800">Faltan {unpicked} partida(s) por elegir precio.</p>}
    </div>
  );
}

function SendButtons({ email, wa, text, numero, onPick }: { email: string | null; wa: string | null; text: string; numero: string; onPick: (m: SendMedium, to: string) => void }) {
  const subject = encodeURIComponent(`Cotización ${numero} - ESC Representaciones`);
  return (
    <div className="grid grid-cols-2 gap-2">
      {email ? (
        <a href={`mailto:${email}?subject=${subject}&body=${encodeURIComponent(text)}`} onClick={() => onPick("correo", email)} className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand-600 hover:text-brand-700">
          <Icon name="mail" className="h-4 w-4" /> Abrir correo
        </a>
      ) : (
        <span className="flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Sin correo del cliente</span>
      )}
      {wa ? (
        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" onClick={() => onPick("whatsapp", wa)} className="flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-green-600 hover:text-green-700">
          <Icon name="chat" className="h-4 w-4" /> Abrir WhatsApp
        </a>
      ) : (
        <span className="flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Sin teléfono del cliente</span>
      )}
    </div>
  );
}

function SendFlow(props: {
  numero: string;
  disabled: boolean;
  busy: string | null;
  email: string | null;
  wa: string | null;
  text: string;
  onDownload: () => void;
  onShare: () => void;
  submitLabel: string;
  onSubmit: (medio: SendMedium, destinatario: string, nota: string) => void;
}) {
  const [medio, setMedio] = useState<SendMedium | null>(null);
  const [to, setTo] = useState("");
  const [nota, setNota] = useState("");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    try {
      setCanShare(typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }));
    } catch {
      setCanShare(false);
    }
  }, []);
  const pick = (m: SendMedium, dest: string) => {
    setMedio(m);
    if (!to) setTo(dest);
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] text-white">1</span>Descarga o comparte el PDF</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={props.disabled} loading={props.busy === "download"} onClick={props.onDownload}>Descargar PDF</Button>
          {canShare && <Button variant="secondary" disabled={props.disabled} loading={props.busy === "share"} onClick={props.onShare}>Compartir PDF</Button>}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] text-white">2</span>Mándalo al cliente <span className="font-normal text-slate-500">(o desde tu propio hilo de correo)</span></p>
        <SendButtons email={props.email} wa={props.wa} text={props.text} numero={props.numero} onPick={pick} />
        <p className="text-xs text-slate-500">El correo y WhatsApp se abren con el mensaje listo; adjunta el PDF que descargaste.</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] text-white">3</span>Registra el envío</p>
        <MediumPicker medio={medio} setMedio={setMedio} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="A quién (correo, teléfono o nombre)" maxLength={200} />
          <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)" maxLength={500} />
        </div>
        <Button className="w-full sm:w-auto" disabled={props.disabled || !medio} loading={props.busy === "issue"} onClick={() => medio && props.onSubmit(medio, to, nota)}>
          {props.submitLabel} ({props.numero})
        </Button>
        {!medio && <p className="text-xs text-slate-500">Elige por qué medio se envió.</p>}
      </div>
    </div>
  );
}

function MediumPicker({ medio, setMedio }: { medio: SendMedium | null; setMedio: (m: SendMedium) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MEDIA.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setMedio(m.id)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${medio === m.id ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
        >
          <Icon name={m.icon} className="h-3.5 w-3.5" />
          {m.label}
        </button>
      ))}
    </div>
  );
}

function SentCard(props: {
  issue: IssueView;
  busy: string | null;
  email: string | null;
  wa: string | null;
  text: string;
  onDownload: () => void;
  onShare: () => void;
  onResend: (medio: SendMedium, destinatario: string, nota: string) => void;
  onRenegotiate: (motivo: string) => void;
}) {
  const { issue } = props;
  const [mode, setMode] = useState<"none" | "resend" | "reneg">("none");
  const [medio, setMedio] = useState<SendMedium | null>(null);
  const [to, setTo] = useState("");
  const [motivo, setMotivo] = useState("");
  const first = issue.sends[0];
  const REASONS = ["El cliente pidió mejor precio", "Igualar precio de la competencia", "Cambio en el envío", "Cliente frecuente / volumen"];
  return (
    <Card className="space-y-4 border-2 border-indigo-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-700">Enviada al cliente</p>
          <h2 className="text-lg font-semibold">{issue.numero}</h2>
          <p className="text-sm text-slate-600">
            {first ? `${fmtDateTime(first.enviado_at)} por ${SEND_MEDIUM_LABEL[first.medio] ?? first.medio}${first.destinatario ? ` a ${first.destinatario}` : ""}` : fmtDateTime(issue.emitidaAt)}
          </p>
          {issue.sends.length > 1 && <p className="text-xs text-slate-500">También reenviada {issue.sends.length - 1} vez(es).</p>}
        </div>
        <div className="text-right">
          {issue.totals.map((t) => <p key={t.currency} className="font-semibold tabular-nums">{t.amount} <span className="text-xs text-slate-500">{t.currency}</span></p>)}
          <p className="text-xs text-slate-500">sin IVA</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={props.busy === "download"} onClick={props.onDownload}>Descargar PDF</Button>
        <Button variant="secondary" onClick={() => setMode(mode === "resend" ? "none" : "resend")}>Registrar otro envío</Button>
        <Button onClick={() => setMode(mode === "reneg" ? "none" : "reneg")}>Recotizar</Button>
      </div>

      {mode === "resend" && (
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <p className="text-sm text-slate-700">Mismo número ({issue.numero}), por otro medio o a otra persona.</p>
          <SendButtons email={props.email} wa={props.wa} text={props.text} numero={issue.numero} onPick={(m, d) => { setMedio(m); if (!to) setTo(d); }} />
          <MediumPicker medio={medio} setMedio={setMedio} />
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="A quién" maxLength={200} />
          <Button disabled={!medio} loading={props.busy === "issue"} onClick={() => medio && props.onResend(medio, to, "")}>Registrar envío</Button>
        </div>
      )}

      {mode === "reneg" && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Se abre una recotización: podrás elegir otro precio o cambiar el envío. Al registrarla nace un <strong>número nuevo</strong>; {issue.numero} se queda tal cual.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setMotivo(r)} className={`rounded-full px-2.5 py-1 text-xs ${motivo === r ? "bg-amber-700 text-white" : "bg-white text-amber-900 ring-1 ring-amber-300"}`}>{r}</button>
            ))}
          </div>
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la recotización" maxLength={500} />
          <Button loading={props.busy === "reneg"} disabled={motivo.trim().length < 3} onClick={() => props.onRenegotiate(motivo)}>Abrir recotización</Button>
        </div>
      )}
    </Card>
  );
}

function ItemCard(props: {
  item: ItemRow;
  requestId: string;
  now: Date;
  remaining: number | null | undefined;
  picked: Pick | undefined;
  pending: boolean;
  renegOpen: boolean;
  onChoose: (n: Pick) => void;
  onCopy: (scope: "item" | "selected", onlySelected: boolean) => void;
  onNotice: (n: Notice) => void;
  onRefresh: () => void;
  onUseAltName: (name: string) => void;
}) {
  const { item, now, picked: sel } = props;
  const q = latestQuote(item);
  const d = q ? item.item_dispatch.find((x) => x.quote_version === q.version) : undefined;
  const vencida = isVigenciaVencida(q, now);
  const outcome = latestOutcome(item);
  const finished = outcome?.resultado === "ganada" || outcome?.resultado === "perdida";
  const open = openUpdateRequest(item);
  const pause = openPause(item);
  const overdue = item.estado === "pendiente" && props.remaining !== null && props.remaining !== undefined && props.remaining <= 0;
  const hasQty = item.cantidad !== null && Number(item.cantidad) > 0;
  const canRequestUpdate = !!q && vencida && (item.estado === "cotizada" || item.estado === "enviada_cliente") && !finished && !open;
  const canPick = !vencida && (item.estado === "cotizada" || (item.estado === "enviada_cliente" && props.renegOpen));
  const versions = [...item.item_quotes].sort((a, b) => b.version - a.version);
  const folio = q ? revisionFolio(item.folio!, q.version) : item.folio;
  const [open_, setOpen] = useState(!d || props.renegOpen);

  return (
    <Card className="space-y-3">
      <button type="button" className="flex w-full flex-wrap items-start justify-between gap-2 text-left" onClick={() => setOpen(!open_)}>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{folio}</p>
          <h3 className="font-medium">{item.producto}</h3>
          <p className="text-sm">{qtyText(item.cantidad, item.unidad, item.talla)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vencida && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Vigencia vencida</span>}
          {sel && q && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-900">P{sel} · ${Number(prices(q)[sel - 1]).toFixed(2)}</span>}
          {outcome && outcome.resultado !== "sin_respuesta" && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${outcome.resultado === "ganada" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{outcome.resultado === "ganada" ? "Ganada" : "Perdida"}</span>
          )}
          <ItemStatusBadge estado={item.estado} vencida={overdue} />
          {item.estado === "pendiente" && props.remaining !== null && props.remaining !== undefined && <SemaforoBadge remaining={props.remaining} />}
          <span className={`text-slate-400 transition ${open_ ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>

      {open_ && (
        <>
          <p className="text-sm text-slate-600"><span className="text-xs text-slate-400">Para qué se usa / descripción (interno): </span>{item.descripcion}</p>
          {q && minAlert(item, q) && <p className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{minAlert(item, q)!.text}</p>}
          {item.notas && <p className="text-xs text-slate-500">Notas: {item.notas}</p>}
          <ReferenceList refs={item.item_references} />

          {item.estado === "no_encontrada" && <Alert tone="info"><strong>No encontrada:</strong> {item.not_found_note}</Alert>}
          {pause && <Alert tone="info">El comprador espera una aclaración tuya. Abre "Aclaraciones y mensajes" para responder.</Alert>}
          {item.estado === "actualizacion_solicitada" && open && <Alert tone="info">Actualización solicitada el {fmtDate(open.requested_at)}. El comprador tiene 48 horas hábiles para responder.</Alert>}

          {q && (
            <div className="space-y-3">
              <div className="grid gap-1 text-sm sm:grid-cols-4">
                <p><span className="text-slate-500">Moneda:</span> {q.moneda}</p>
                <p><span className="text-slate-500">Entrega:</span> {formatDelivery(q)}</p>
                <p><span className="text-slate-500">Compra mínima:</span> {describeMin(q, item.unidad)}</p>
                <p>
                  <span className="text-slate-500">Vigencia:</span>{" "}
                  {q.valid_until ? (vencida ? <span className="font-medium text-red-700">vencida el {fmtDate(q.valid_until)}</span> : `hasta ${fmtDate(q.valid_until)} (${vigenciaDiasRestantes(q, now)} días)`) : "-"}
                </p>
              </div>
              {q.alt_nombre && (
                <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium text-amber-900">Producto alternativo sugerido</p>
                  <p>{q.alt_nombre}{q.alt_descripcion ? <span className="text-slate-600"> ({q.alt_descripcion})</span> : null}</p>
                  <p className="text-slate-700">Por qué sirve para lo mismo: {q.alt_motivo}</p>
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => props.onUseAltName(q.alt_nombre!)}>Usar este nombre en el PDF</Button>
                </div>
              )}
              {q.nota && <p className="text-sm text-slate-600">Nota del comprador: {q.nota}</p>}

              <div className="overflow-x-auto">
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
                      const wasSent = d?.precio_elegido === n;
                      return (
                        <tr key={n} className={sel === n ? "bg-brand-50" : ""}>
                          <td className="py-1.5 pr-2">
                            <input type="radio" className="h-4 w-4" name={`precio-${item.id}`} checked={sel === n} disabled={!canPick || props.pending} onChange={() => props.onChoose(n)} aria-label={`Elegir precio ${n}`} />
                          </td>
                          <td className="py-1.5 pr-2">Precio {n}{wasSent && <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-800">enviado</span>}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">${Number(p).toFixed(2)} {q.moneda}</td>
                          {hasQty && <td className="py-1.5 text-right tabular-nums">${lineTotal(Number(p).toFixed(2), item.cantidad!)} {q.moneda}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Precios sin IVA.{" "}
                {d && !props.renegOpen && "El precio enviado quedó fijo; para cambiarlo usa Recotizar."}
                {props.renegOpen && d && "Recotización abierta: puedes elegir otro precio."}
                {canPick && !sel && <span className="font-medium text-amber-800">Elige el precio que pasarás al cliente.</span>}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" className="text-xs" onClick={() => props.onCopy("item", false)}>Copiar tabla de precios</Button>
                <Button variant="secondary" className="text-xs" disabled={!sel} onClick={() => props.onCopy("selected", true)}>Copiar solo el precio elegido</Button>
              </div>

              {canRequestUpdate && <RequestUpdate itemId={item.id} onNotice={props.onNotice} onRefresh={props.onRefresh} />}
              {vencida && !canRequestUpdate && finished && <p className="text-xs text-slate-500">La cotización ya tiene resultado, por eso no se puede pedir actualización.</p>}
              {d && <OutcomeForm itemId={item.id} cantidadSolicitada={item.cantidad} onNotice={props.onNotice} onRefresh={props.onRefresh} outcome={outcome} />}

              {versions.length > 1 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-slate-600">Versiones anteriores ({versions.length - 1})</summary>
                  <ul className="mt-1 space-y-1 text-xs text-slate-600">
                    {versions.slice(1).map((v) => (
                      <li key={v.version}>v{v.version} ({fmtDate(v.quoted_at)}, {v.moneda}): {prices(v).map((p, i) => `P${i + 1} $${Number(p).toFixed(2)}`).join(" · ")}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <ItemChat itemId={item.id} requestId={props.requestId} me="vendedor" messages={item.item_messages ?? []} waitingForSeller={!!pause} />
        </>
      )}
    </Card>
  );
}

function RequestUpdate({ itemId, onNotice, onRefresh }: { itemId: string; onNotice: (n: Notice) => void; onRefresh: () => void }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [nota, setNota] = useState("");
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm">
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
          loading={pending}
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
  onNotice: (n: Notice) => void;
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
      <p className="text-sm font-medium">¿Qué respondió el cliente?</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {([["sin_respuesta", "Sin respuesta", "border-slate-300"], ["ganada", "Ganada", "border-green-600"], ["perdida", "Perdida", "border-red-500"]] as const).map(([val, label, ring]) => (
          <label key={val} className={`flex cursor-pointer items-center gap-1.5 rounded-full border bg-white px-3 py-1 ${v.resultado === val ? ring + " ring-1" : "border-slate-200"}`}>
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
        loading={pending}
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
