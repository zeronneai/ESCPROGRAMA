import Link from "next/link";
import { DateTime } from "luxon";
import { Icon } from "@/components/icons";
import { Card, EmptyState, FilterChip, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import type { ItemStatus } from "@/lib/quotes/types";
import { PIPELINE, requestStage, STAGE_INFO, type PipelineGroup, type StageResult } from "@/lib/stats/seller-pipeline";
import { createClient } from "@/lib/supabase/server";
import { businessHoursBetween } from "@/lib/time/business-hours";

interface ReqRow {
  id: string;
  folio: string;
  submitted_at: string;
  due_at: string;
  customers: { nombre: string } | null;
  quote_items: {
    producto: string;
    descripcion: string;
    estado: ItemStatus;
    item_quotes: { version: number; valid_until: string | null }[];
    item_dispatch: { quote_version: number; enviado_at: string }[];
    item_outcomes: { quote_version: number; resultado: "sin_respuesta" | "ganada" | "perdida"; updated_at: string }[];
  }[];
  quote_issues: { numero: string; emitida_at: string; quote_issue_sends: { enviado_at: string }[] }[];
  quote_renegotiations: { cerrada_at: string | null }[];
}

const TONE: Record<string, string> = {
  purple: "border-l-purple-500 bg-purple-50",
  amber: "border-l-amber-500 bg-amber-50",
  red: "border-l-red-500 bg-red-50",
  indigo: "border-l-indigo-500 bg-indigo-50",
};
const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);
const ago = (iso: string, now: Date) => {
  const d = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
};

export default async function VendedorHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const etapa = (sp.etapa ?? "") as PipelineGroup | "accion" | "";
  const buscar = (sp.buscar ?? "").trim().toLowerCase();

  const [{ data, error }, { data: drafts }] = await Promise.all([
    supabase
      .from("quote_requests")
      .select(
        `id, folio, submitted_at, due_at, customers(nombre),
         quote_items!quote_items_request_id_fkey(producto, descripcion, estado, item_quotes(version, valid_until), item_dispatch(quote_version, enviado_at), item_outcomes(quote_version, resultado, updated_at)),
         quote_issues!quote_issues_request_id_fkey(numero, emitida_at, quote_issue_sends(enviado_at)),
         quote_renegotiations!quote_renegotiations_request_id_fkey(cerrada_at)`,
      )
      .eq("vendedor_id", user.id)
      .eq("estado", "enviada")
      .is("archived_at", null)
      .order("submitted_at", { ascending: false })
      .limit(500),
    supabase
      .from("quote_requests")
      .select("id, created_at, customers(nombre)")
      .eq("vendedor_id", user.id)
      .eq("estado", "borrador")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const now = new Date();
  const rows = ((data ?? []) as unknown as ReqRow[]).map((r) => {
    const sends = [
      ...r.quote_issues.flatMap((x) => x.quote_issue_sends.map((s) => s.enviado_at)),
      ...r.quote_items.flatMap((i) => i.item_dispatch.map((d) => d.enviado_at)),
    ].sort();
    const s: StageResult = requestStage(
      { items: r.quote_items, renegotiationOpen: r.quote_renegotiations.some((x) => !x.cerrada_at), lastSentAt: sends.at(-1) ?? null },
      now,
    );
    const lastIssue = [...r.quote_issues].sort((a, b) => b.emitida_at.localeCompare(a.emitida_at))[0];
    return { r, s, lastIssue, lastSent: sends.at(-1) ?? null, remaining: businessHoursBetween(now, new Date(r.due_at), cfg) };
  });

  // Indicadores: ultimos 90 dias por solicitud, y envios del mes.
  const monthStart = DateTime.now().setZone(cfg.timezone).startOf("month").toJSDate();
  const recent = rows.filter((x) => now.getTime() - new Date(x.r.submitted_at).getTime() < 90 * 86_400_000);
  const ganadas90 = recent.filter((x) => x.s.stage === "ganada").length;
  const perdidas90 = recent.filter((x) => x.s.stage === "perdida").length;
  const enviadasMes = rows.filter((x) => x.lastSent && new Date(x.lastSent) >= monthStart).length;
  const ganadasMes = rows.filter((x) => x.r.quote_items.some((i) => i.item_outcomes.some((o) => o.resultado === "ganada" && new Date(o.updated_at) >= monthStart))).length;

  const action = rows.filter((x) => x.s.action).sort((a, b) => ["purple", "red", "amber", "indigo"].indexOf(a.s.action!.tone) - ["purple", "red", "amber", "indigo"].indexOf(b.s.action!.tone));
  const byGroup = Object.fromEntries(PIPELINE.map((p) => [p.id, rows.filter((x) => STAGE_INFO[x.s.stage].group === p.id).length])) as Record<PipelineGroup, number>;
  const open = rows.length - byGroup.ganada - byGroup.cerrada;

  const shown = rows.filter((x) => {
    if (etapa === "accion" && !x.s.action) return false;
    if (etapa && etapa !== "accion" && STAGE_INFO[x.s.stage].group !== etapa) return false;
    if (!buscar) return true;
    return [x.r.folio, x.r.customers?.nombre ?? "", x.lastIssue?.numero ?? "", ...x.r.quote_items.flatMap((i) => [i.producto, i.descripcion])]
      .some((f) => f.toLowerCase().includes(buscar));
  });
  const href = (e?: string) => {
    const p = new URLSearchParams();
    if (e) p.set("etapa", e);
    if (sp.buscar) p.set("buscar", sp.buscar);
    const s = p.toString();
    return `/vendedor${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis cotizaciones"
        subtitle="Lo urgente arriba; abajo el avance de todas tus solicitudes."
        actions={
          <Link href="/vendedor/solicitudes/nueva" className="hidden items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 md:inline-flex">
            <Icon name="plus" className="h-4 w-4" /> Nueva solicitud
          </Link>
        }
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudieron cargar tus solicitudes: {error.message}</Card>}

      {/* 1. Lo que requiere accion */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Requieren tu atención</h2>
          {action.length > 5 && <Link href={href("accion")} className="text-sm font-medium text-brand-600 hover:underline">Ver las {action.length}</Link>}
        </div>
        {action.length === 0 ? (
          <Card className="flex items-center gap-3 border-green-200 bg-green-50 text-sm text-green-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white">✓</span>
            Nada pendiente de tu lado. Buen trabajo.
          </Card>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {action.slice(0, 6).map(({ r, s }) => (
              <li key={r.id}>
                <Link href={`/vendedor/solicitudes/${r.id}`} className={`flex items-center justify-between gap-3 rounded-lg border border-l-4 border-slate-200 px-4 py-3 transition hover:shadow-sm ${TONE[s.action!.tone]}`}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{r.customers?.nombre} <span className="font-normal text-slate-500">· {r.folio}</span></p>
                    <p className="text-sm text-slate-700">{s.action!.text}</p>
                  </div>
                  <span className="shrink-0 text-slate-400">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Embudo */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Avance de tus cotizaciones</h2>
          <span className="text-sm text-slate-500">{open} abiertas</span>
        </div>
        <Card className="space-y-4 p-4">
          {rows.length > 0 && (
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              {PIPELINE.map((p) => (byGroup[p.id] ? <div key={p.id} className={p.bar} style={{ width: `${(byGroup[p.id] / rows.length) * 100}%` }} /> : null))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PIPELINE.map((p) => (
              <Link
                key={p.id}
                href={etapa === p.id ? href() : href(p.id)}
                className={`rounded-lg border p-3 transition hover:border-slate-400 ${etapa === p.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <span className={`h-2.5 w-2.5 rounded-full ${p.bar}`} />
                  {p.label}
                </span>
                <span className={`mt-1 block text-2xl font-semibold tabular-nums ${p.text}`}>{byGroup[p.id]}</span>
                <span className="block text-[11px] text-slate-500">{p.hint}</span>
              </Link>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
            <div>
              <p className="text-lg font-semibold tabular-nums">{pct(ganadas90 + perdidas90 ? ganadas90 / (ganadas90 + perdidas90) : null)}</p>
              <p className="text-[11px] text-slate-500">Conversión (90 días)</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums">{enviadasMes}</p>
              <p className="text-[11px] text-slate-500">Enviadas este mes</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums text-green-700">{ganadasMes}</p>
              <p className="text-[11px] text-slate-500">Ganadas este mes</p>
            </div>
          </div>
        </Card>
      </section>

      {(drafts ?? []).length > 0 && (
        <Card className="space-y-1">
          <h2 className="text-sm font-medium">Borradores sin enviar</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(drafts ?? []).map((d) => (
              <li key={d.id}>
                <Link href={`/vendedor/solicitudes/${d.id}/editar`} className="inline-block rounded-full border border-slate-300 px-3 py-1 hover:border-brand-600 hover:text-brand-700">
                  {(d.customers as unknown as { nombre: string } | null)?.nombre ?? "Sin cliente"} · {new Date(d.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 3. Lista por cotizacion */}
      <section className="space-y-3">
        <form method="get" className="flex gap-2">
          {etapa && <input type="hidden" name="etapa" value={etapa} />}
          <input
            name="buscar"
            defaultValue={sp.buscar ?? ""}
            placeholder="Buscar cliente, folio o producto"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Buscar</button>
        </form>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <FilterChip href={href()} active={!etapa}>Todas {rows.length}</FilterChip>
          <FilterChip href={href("accion")} active={etapa === "accion"}>Requieren atención {action.length}</FilterChip>
          {PIPELINE.map((p) => (
            <FilterChip key={p.id} href={href(p.id)} active={etapa === p.id}>{p.label} {byGroup[p.id]}</FilterChip>
          ))}
        </div>

        <Card className="p-0">
          {shown.length === 0 ? (
            <EmptyState
              title={rows.length === 0 ? "Aún no tienes solicitudes" : "No hay cotizaciones en esta vista"}
              action={rows.length === 0 ? <Link href="/vendedor/solicitudes/nueva" className="text-sm font-medium text-brand-600 hover:underline">Crear la primera</Link> : undefined}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map(({ r, s, lastIssue, lastSent, remaining }) => {
                const info = STAGE_INFO[s.stage];
                const detail =
                  s.stage === "con_compras" ? (remaining > 0 ? `${s.counts.conCompras} por cotizar · quedan ${Math.round(remaining)} h hábiles` : `${s.counts.conCompras} por cotizar · plazo vencido`)
                  : s.stage === "por_enviar" ? `${s.counts.porEnviar} de ${s.counts.total} con precio, sin enviar`
                  : s.stage === "con_cliente" && lastSent ? `${lastIssue?.numero ?? "Enviada"} · ${ago(lastSent, now)}`
                  : s.stage === "ganada" ? `${s.counts.ganadas} de ${s.counts.enviadas} partida(s) ganadas`
                  : s.stage === "perdida" ? "Cliente no compró"
                  : s.stage === "cerrada" ? "Ninguna partida se encontró"
                  : s.stage === "recotizando" ? `Saldrá con número nuevo`
                  : "Abre la partida marcada";
                const products = r.quote_items.map((i) => i.producto);
                return (
                  <li key={r.id}>
                    <Link href={`/vendedor/solicitudes/${r.id}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {r.customers?.nombre}
                          <span className="ml-2 text-xs font-normal text-slate-500">{r.folio} · {new Date(r.submitted_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}</span>
                        </p>
                        <p className="truncate text-sm text-slate-600">
                          {products.slice(0, 2).join(", ")}
                          {products.length > 2 && ` y ${products.length - 2} más`}
                        </p>
                        <Progress s={s} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${info.chip}`}>{info.label}</span>
                        <span className={`text-xs ${s.action?.tone === "red" ? "font-medium text-red-700" : "text-slate-500"}`}>{s.action?.tone === "red" || s.action?.tone === "indigo" ? s.action.text : detail}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

/** Barra de avance por partidas: con compras, con precio sin enviar, enviadas, ganadas. */
function Progress({ s }: { s: StageResult }) {
  const c = s.counts;
  if (!c.total) return null;
  const open = Math.max(c.enviadas - c.ganadas - c.perdidas, 0);
  const seg = [
    { n: c.conCompras, cls: "bg-sky-400" },
    { n: c.porEnviar, cls: "bg-amber-400" },
    { n: open, cls: "bg-indigo-400" },
    { n: c.ganadas, cls: "bg-green-500" },
    { n: c.perdidas, cls: "bg-slate-300" },
  ];
  const rest = Math.max(c.total - seg.reduce((a, x) => a + x.n, 0), 0);
  return (
    <div className="mt-1.5 flex h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-100" title={`${c.total} partida(s)`}>
      {seg.map((x, i) => (x.n ? <div key={i} className={x.cls} style={{ width: `${(x.n / c.total) * 100}%` }} /> : null))}
      {rest > 0 && <div className="bg-slate-200" style={{ width: `${(rest / c.total) * 100}%` }} />}
    </div>
  );
}
