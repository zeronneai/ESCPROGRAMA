"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logCopyAction, markDispatchedAction } from "@/actions/requests";
import { Alert, Button, Card } from "@/components/ui";
import { ItemStatusBadge, qtyText, ReferenceList, SemaforoBadge } from "@/components/status";
import { copyRich } from "@/lib/clipboard";
import { formatDelivery, formatMinPurchase, toPriceTableItem } from "@/lib/format/quote-text";
import { formatPriceTable } from "@/lib/format/price-table";
import { latestDispatch, latestQuote, type ItemRow } from "@/lib/quotes/types";
import { lineTotal } from "@/lib/pricing/tabulador";

interface Props {
  request: { id: string; folio: string; notas: string | null; cliente: string; remaining: number | null; dueAt: string | null };
  items: ItemRow[];
}

type Pick = 1 | 2 | 3 | 4 | 5;

export function SellerRequestView({ request, items }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [picked, setPicked] = useState<Record<string, Pick | undefined>>(() => {
    const init: Record<string, Pick | undefined> = {};
    for (const i of items) {
      const d = latestDispatch(i);
      if (d) init[i.id] = d.precio_elegido as Pick;
    }
    return init;
  });

  const quoted = items.filter((i) => latestQuote(i));
  const hasPending = items.some((i) => i.estado === "pendiente");

  async function copy(list: ItemRow[], scope: "item" | "request" | "selected", entityId: string, onlySelected = false) {
    const tableItems = list.map((i) => toPriceTableItem(
      { folio: i.folio!, producto: i.producto, descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad, talla: i.talla },
      latestQuote(i)!,
      picked[i.id] ?? null,
    ));
    const content = formatPriceTable(tableItems, { onlySelected });
    try {
      const mode = await copyRich(content);
      setNotice({
        tone: "success",
        text: mode === "rich"
          ? "Copiado. Al pegar en Outlook o Word sale como tabla; en WhatsApp, como texto."
          : "Copiado como texto (tu navegador no permite copiar con formato).",
      });
      // Solo metadatos: nunca se guarda el contenido copiado.
      void logCopyAction(entityId, { scope, count: list.length });
    } catch {
      setNotice({ tone: "error", text: "No se pudo copiar. Selecciona el contenido y copialo manualmente." });
    }
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/vendedor" className="text-sm text-slate-600 hover:underline">
          Mis solicitudes
        </Link>
        <span className="text-slate-400">/</span>
        <h1 className="text-lg font-semibold">{request.folio}</h1>
        <span className="text-sm text-slate-600">{request.cliente}</span>
        {hasPending && request.remaining !== null && <SemaforoBadge remaining={request.remaining} />}
      </div>
      {request.notas && <p className="text-sm text-slate-600">Notas: {request.notas}</p>}

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {quoted.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => copy(quoted, "request", request.id)}>
            Copiar tabla de precios de toda la solicitud
          </Button>
        </div>
      )}

      {items.map((item) => {
        const q = latestQuote(item);
        const d = latestDispatch(item);
        const sel = picked[item.id];
        const vencida = item.estado === "pendiente" && request.remaining !== null && request.remaining <= 0;
        const prices = q ? ([q.price_1, q.price_2, q.price_3, q.price_4, q.price_5] as const) : null;
        const hasQty = item.cantidad !== null && Number(item.cantidad) > 0;
        return (
          <Card key={item.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">{item.folio}</p>
                <h2 className="font-medium">{item.producto}</h2>
                <p className="text-sm text-slate-600">{item.descripcion}</p>
                <p className="mt-1 text-sm">{qtyText(item.cantidad, item.unidad, item.talla)}</p>
                {item.notas && <p className="text-xs text-slate-500">Notas: {item.notas}</p>}
              </div>
              <ItemStatusBadge estado={item.estado} vencida={vencida} />
            </div>
            <ReferenceList refs={item.item_references} />

            {item.estado === "no_encontrada" && (
              <Alert tone="info">
                <strong>No encontrada:</strong> {item.not_found_note}
              </Alert>
            )}

            {q && prices && (
              <div className="space-y-3">
                <div className="grid gap-1 text-sm sm:grid-cols-3">
                  <p>
                    <span className="text-slate-500">Moneda:</span> {q.moneda}
                  </p>
                  <p>
                    <span className="text-slate-500">Entrega:</span> {formatDelivery(q)}
                  </p>
                  <p>
                    <span className="text-slate-500">Compra minima:</span> {formatMinPurchase(q) ?? "Sin minimo"}
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
                    {prices.map((p, idx) => {
                      const n = (idx + 1) as Pick;
                      return (
                        <tr key={n} className={sel === n ? "bg-brand-50" : ""}>
                          <td className="py-1 pr-2">
                            <input
                              type="radio"
                              name={`precio-${item.id}`}
                              checked={sel === n}
                              disabled={!!d || item.estado !== "cotizada"}
                              onChange={() => setPicked({ ...picked, [item.id]: n })}
                              aria-label={`Elegir precio ${n}`}
                            />
                          </td>
                          <td className="py-1 pr-2">Precio {n}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            ${Number(p).toFixed(2)} {q.moneda}
                          </td>
                          {hasQty && (
                            <td className="py-1 text-right tabular-nums">
                              ${lineTotal(Number(p).toFixed(2), item.cantidad!)} {q.moneda}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={() => copy([item], "item", item.id)}>
                    Copiar tabla de precios
                  </Button>
                  <Button variant="secondary" disabled={!sel} onClick={() => copy([item], "selected", item.id, true)}>
                    Copiar solo el precio elegido
                  </Button>
                  {item.estado === "cotizada" && (
                    <Button disabled={!sel || pending} onClick={() => dispatch(item)}>
                      Enviado al cliente
                    </Button>
                  )}
                  {item.estado === "cotizada" && !sel && (
                    <span className="text-xs text-amber-800">Elige el precio que pasaste al cliente.</span>
                  )}
                  {d && (
                    <span className="text-sm text-slate-600">
                      Enviado al cliente: Precio {d.precio_elegido} (${Number(d.valor).toFixed(2)} {q.moneda}) el{" "}
                      {new Date(d.enviado_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
