import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ItemStatusBadge, qtyText, ReferenceList } from "@/components/status";
import { Timeline } from "@/components/timeline";
import { requireUser } from "@/lib/auth/guards";
import { ETAPAS, etapaSolicitud } from "@/lib/cotizaciones-gerente";
import { getBusinessSettings, withMessageImageUrls, withSignedUrls } from "@/lib/quotes/server";
import { LOSS_REASON_LABEL, latestOutcome, latestQuote, type ItemRow } from "@/lib/quotes/types";
import { buildTimeline, emissionEvents } from "@/lib/stats/timeline";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Detalle de una solicitud para la gerente: lo que pidio el vendedor, lo que respondio compras (precios, costo,
 * entrega, imagenes, aclaraciones) y las etapas. Nunca lo del comprador (proveedor, links, contacto, parte, notas).
 */
export default async function CotizacionGerente({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, folio, estado, notas, atencion, destino_entrega, created_at, submitted_at, due_at, customers:customers!quote_requests_customer_id_fkey(nombre, razon_social, rfc, contacto_nombre), profiles:vendedor_id(nombre)")
    .eq("id", id)
    .maybeSingle();
  if (!req || req.estado !== "enviada") notFound();
  const [{ data: items }, { data: issues }, { data: renegs }, costosRes] = await Promise.all([
    supabase
      .from("quote_items")
      .select("*, item_references(id, tipo, url), item_quotes(*), item_dispatch(*), item_update_requests(*), item_clarification_pauses(*), item_messages(*), item_outcomes(*), item_price_choice(*)")
      .eq("request_id", id)
      .order("posicion"),
    supabase.from("quote_issues").select("id, numero, revision, emitida_at, snapshot, quote_issue_sends(id, medio, destinatario, enviado_at)").eq("request_id", id).order("emitida_at", { ascending: false }),
    supabase.from("quote_renegotiations").select("id, motivo, abierta_at, cerrada_at, cancelada, issue_id").eq("request_id", id).order("abierta_at"),
    supabase.rpc("costos_solicitud", { p_request: id }),
  ]);
  let rows = (await withSignedUrls(supabase, (items ?? []) as unknown as ItemRow[])) as ItemRow[];
  rows = await withMessageImageUrls(supabase, rows);
  // Imagen que subio compras para el PDF.
  const fotoPaths = rows.map((r) => r.foto_compra_path).filter((p): p is string => !!p);
  const fotos = new Map<string, string>();
  if (fotoPaths.length) {
    const { data } = await supabase.storage.from("aclaraciones").createSignedUrls(fotoPaths, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) fotos.set(d.path, d.signedUrl);
  }
  const costos = new Map<string, { costo: number; envio: number | null }>();
  for (const c of (costosRes.data ?? []) as { item_id: string; version: number; costo: string; envio: string | null }[]) costos.set(`${c.item_id}:${c.version}`, { costo: Number(c.costo), envio: c.envio == null ? null : Number(c.envio) });

  const f = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso, { zone: cfg.timezone }).toFormat("dd/LL/yyyy HH:mm") : "");
  const dinero = (n: number | string | null | undefined, m = "") => (n == null || n === "" ? "" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m ? ` ${m}` : ""}`);
  const cliente = req.customers as unknown as { nombre: string; razon_social: string | null; rfc: string | null; contacto_nombre: string | null } | null;
  const vendedor = (req.profiles as unknown as { nombre: string } | null)?.nombre ?? "";
  const iss = (issues ?? []) as unknown as { id: string; numero: string; revision: number; emitida_at: string; snapshot: { totals?: { currency: string; amount: string }[] }; quote_issue_sends: { id: string; medio: string; destinatario: string | null; enviado_at: string }[] }[];
  const etapa = etapaSolicitud(rows, iss.length > 0);
  const primera = rows.map((r) => r.first_response_at).filter((x): x is string => !!x).sort()[0] ?? null;

  return (
    <div className="space-y-4">
      <Link href="/cotizaciones" className="text-sm text-brand-700 underline">← Cotizaciones</Link>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{req.folio}</h1>
            <p className="text-sm text-slate-600">{cliente?.nombre}{cliente?.razon_social && cliente.razon_social !== cliente.nombre ? ` · ${cliente.razon_social}` : ""} · Vendedor: {vendedor}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${ETAPAS[etapa].cls}`}>{ETAPAS[etapa].label}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Solicitud enviada a compras", f(req.submitted_at)],
            ["Fecha límite de compras", f(req.due_at)],
            ["Primera respuesta", primera ? f(primera) : "Sin respuesta"],
            ["Atención / destino", [req.atencion, req.destino_entrega].filter(Boolean).join(" · ") || "-"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        {req.notas && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Notas del vendedor: {req.notas}</p>}
      </div>

      {iss.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Cotizaciones enviadas al cliente</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {iss.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b>{x.numero}</b> · {f(x.emitida_at)} · {(x.snapshot.totals ?? []).map((t) => `${dinero(t.amount)} ${t.currency}`).join(" + ")}
                  {x.quote_issue_sends.length > 0 && <span className="block text-xs text-slate-500">Enviada por {x.quote_issue_sends.map((s) => s.medio).join(", ")}</span>}
                </span>
                <a href={`/api/pdf/${req.id}?emision=${x.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Ver PDF</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.map((i) => {
        const q = latestQuote(i);
        const o = latestOutcome(i);
        const c = q ? costos.get(`${i.id}:${q.version}`) : undefined;
        const d = [...(i.item_dispatch ?? [])].sort((a, b) => b.enviado_at.localeCompare(a.enviado_at))[0];
        const foto = i.foto_compra_path ? fotos.get(i.foto_compra_path) : null;
        return (
          <div key={i.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">{i.folio}</p>
                <h3 className="font-semibold">{i.producto}</h3>
                <p className="text-sm text-slate-600">{qtyText(i.cantidad, i.unidad, i.talla)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ItemStatusBadge estado={i.estado} />
                {o && o.resultado !== "sin_respuesta" && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${o.resultado === "ganada" ? "bg-emerald-600 text-white" : "bg-red-100 text-red-800"}`}>
                    {o.resultado === "ganada" ? "Ganada" : `Perdida${o.motivo ? `: ${LOSS_REASON_LABEL[o.motivo]}` : ""}`}
                  </span>
                )}
              </div>
            </div>
            {i.descripcion && <p className="mt-2 whitespace-pre-line text-sm">{i.descripcion}</p>}
            {i.notas && <p className="mt-1 text-sm text-slate-600">Notas: {i.notas}</p>}
            <div className="mt-3 flex flex-wrap items-start gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">Referencias del vendedor</p>
                <ReferenceList refs={i.item_references ?? []} />
              </div>
              {foto && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">Imagen de compras (sale en el PDF)</p>
                  <a href={foto} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={foto} alt="Imagen del producto" className="h-20 w-20 rounded border border-slate-200 object-cover" />
                  </a>
                </div>
              )}
            </div>
            {i.estado === "no_encontrada" && <p className="mt-3 rounded bg-slate-100 px-3 py-2 text-sm">No se encontró{i.not_found_note ? `: ${i.not_found_note}` : ""}</p>}
            {q && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Versión</th>
                      {c && <th className="px-3 py-1.5 text-right">Costo</th>}
                      {c?.envio != null && <th className="px-3 py-1.5 text-right">Envío</th>}
                      {[1, 2, 3, 4, 5].map((n) => <th key={n} className="px-3 py-1.5 text-right">Precio {n}</th>)}
                      <th className="px-3 py-1.5 text-left">Entrega</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-1.5">{q.version} · {f(q.quoted_at)}</td>
                      {c && <td className="px-3 py-1.5 text-right">{dinero(c.costo, q.moneda)}</td>}
                      {c?.envio != null && <td className="px-3 py-1.5 text-right">{dinero(c.envio)}</td>}
                      {[q.price_1, q.price_2, q.price_3, q.price_4, q.price_5].map((p, n) => (
                        <td key={n} className={`px-3 py-1.5 text-right ${d && d.precio_elegido === n + 1 ? "font-bold text-brand-800" : ""}`}>{dinero(p)}</td>
                      ))}
                      <td className="px-3 py-1.5">{q.entrega_fecha ? `Fecha ${q.entrega_fecha}` : q.entrega_dias != null ? `${q.entrega_dias} días ${q.entrega_tipo === "habiles" ? "hábiles" : "naturales"}` : ""}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="space-y-0.5 px-3 py-2 text-xs text-slate-600">
                  <p>Moneda: {q.moneda}{d ? ` · Al cliente con el Precio ${d.precio_elegido} (${f(d.enviado_at)})` : ""}</p>
                  {(q.compra_min_cantidad || q.compra_min_monto) && <p>Compra mínima: {q.compra_min_cantidad ? `${Number(q.compra_min_cantidad)} ${q.compra_min_unidad ?? ""}` : ""}{q.compra_min_monto ? ` ${dinero(q.compra_min_monto)}` : ""}</p>}
                  {q.alt_nombre && <p>Alternativo sugerido: <b>{q.alt_nombre}</b>{q.alt_motivo ? ` (${q.alt_motivo})` : ""}</p>}
                  {q.nota && <p>Nota de compras: {q.nota}</p>}
                  {o?.resultado === "ganada" && o.cantidad_final && <p>Cantidad final ganada: {Number(o.cantidad_final)}</p>}
                  {o?.motivo_texto && <p>Comentario del resultado: {o.motivo_texto}</p>}
                </div>
              </div>
            )}
            {(i.item_messages ?? []).length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Aclaraciones ({i.item_messages!.length})</summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {[...i.item_messages!].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => (
                    <li key={m.id} className={`rounded-lg px-3 py-2 ${m.author_rol === "comprador" ? "bg-brand-50" : "bg-slate-50"}`}>
                      <span className="text-xs text-slate-500">{m.author_rol === "comprador" ? "Compras" : "Vendedor"} · {f(m.created_at)}</span>
                      {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                      {m.imageUrl && (
                        <a href={m.imageUrl} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.imageUrl} alt="Imagen de la aclaración" className="mt-1 h-20 rounded border border-slate-200 object-cover" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}

      <Timeline
        title="Etapas del proceso"
        events={[
          ...buildTimeline({ folio: req.folio!, created_at: req.created_at, submitted_at: req.submitted_at, due_at: req.due_at }, rows, { skipDispatch: iss.length > 0 }),
          ...emissionEvents(iss.map((i) => ({ numero: i.numero, sends: i.quote_issue_sends })), renegs ?? []),
        ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())}
      />
    </div>
  );
}
