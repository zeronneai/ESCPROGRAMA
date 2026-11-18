import Link from "next/link";
import { DateTime } from "luxon";
import { FilterChip, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ETAPAS, etapaSolicitud, type EtapaSolicitud } from "@/lib/cotizaciones-gerente";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  folio: string | null;
  submitted_at: string;
  due_at: string | null;
  customers: { nombre: string } | null;
  profiles: { nombre: string } | null;
  quote_items: { estado: string; first_response_at: string | null; item_outcomes: { resultado: string; quote_version: number }[] }[];
  quote_issues: { numero: string; emitida_at: string }[];
};

/** Cotizaciones (gerente): todas las solicitudes con su etapa, sin datos del comprador. */
export default async function CotizacionesGerente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data, error } = await supabase
    .from("quote_requests")
    .select(
      "id, folio, submitted_at, due_at, customers:customers!quote_requests_customer_id_fkey(nombre), profiles:vendedor_id(nombre), quote_items!quote_items_request_id_fkey(estado, first_response_at, item_outcomes(resultado, quote_version)), quote_issues!quote_issues_request_id_fkey(numero, emitida_at)",
    )
    .eq("estado", "enviada")
    .order("submitted_at", { ascending: false })
    .limit(400);
  const all = ((data ?? []) as unknown as Row[]).map((r) => {
    const respuestas = r.quote_items.map((i) => i.first_response_at).filter((x): x is string => !!x).sort();
    return { ...r, etapa: etapaSolicitud(r.quote_items, r.quote_issues.length > 0), primera: respuestas[0] ?? null };
  });
  const q = (sp.q ?? "").trim().toLowerCase();
  const etapa = (sp.etapa as EtapaSolicitud | undefined) && sp.etapa! in ETAPAS ? (sp.etapa as EtapaSolicitud) : null;
  const vendedor = sp.vendedor ?? "";
  const rows = all.filter(
    (r) =>
      (!etapa || r.etapa === etapa) &&
      (!vendedor || r.profiles?.nombre === vendedor) &&
      (!q || `${r.folio} ${r.customers?.nombre}`.toLowerCase().includes(q)),
  );
  const vendedores = [...new Set(all.map((r) => r.profiles?.nombre).filter((x): x is string => !!x))].sort();
  const cuenta = (e: EtapaSolicitud) => all.filter((r) => r.etapa === e).length;
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, etapa: sp.etapa, vendedor: sp.vendedor, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/cotizaciones${p.size ? `?${p}` : ""}`;
  };
  const f = (iso: string | null) => (iso ? DateTime.fromISO(iso, { zone: cfg.timezone }).toFormat("dd/LL/yy HH:mm") : "");
  const horas = (a: string, b: string | null) => {
    if (!b) return null;
    const h = (new Date(b).getTime() - new Date(a).getTime()) / 36e5;
    return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} días`;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Cotizaciones" subtitle="Todas las solicitudes de los vendedores y en qué etapa van. Sin proveedores ni links de compra." />
      <div className="flex flex-wrap gap-2">
        <FilterChip href={link({ etapa: null })} active={!etapa}>Todas ({all.length})</FilterChip>
        {(Object.keys(ETAPAS) as EtapaSolicitud[]).map((e) => (
          <FilterChip key={e} href={link({ etapa: e })} active={etapa === e}>{ETAPAS[e].label} ({cuenta(e)})</FilterChip>
        ))}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {etapa && <input type="hidden" name="etapa" value={etapa} />}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Buscar folio o cliente
          <input name="q" defaultValue={sp.q ?? ""} className="w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Vendedor
          <select name="vendedor" defaultValue={vendedor} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {vendedores.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <button className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white">Filtrar</button>
      </form>
      {error && <p className="text-sm text-red-700">{error.message}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Folio</th><th className="px-3 py-2 text-left">Cliente / vendedor</th><th className="px-3 py-2 text-left">Solicitada</th>
              <th className="px-3 py-2 text-left">Primera respuesta</th><th className="px-3 py-2 text-right">Partidas</th><th className="px-3 py-2 text-left">Cotización al cliente</th><th className="px-3 py-2 text-left">Etapa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ultima = [...r.quote_issues].sort((a, b) => b.emitida_at.localeCompare(a.emitida_at))[0];
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-brand-50/50">
                  <td className="whitespace-nowrap px-3 py-2"><Link href={`/cotizaciones/${r.id}`} className="font-medium text-brand-700 underline">{r.folio}</Link></td>
                  <td className="px-3 py-2">{r.customers?.nombre}<span className="block text-xs text-slate-500">{r.profiles?.nombre}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{f(r.submitted_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.primera ? <>{f(r.primera)}<span className="block text-xs text-slate-500">en {horas(r.submitted_at, r.primera)}</span></> : <span className="text-slate-400">Sin respuesta</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.quote_items.length}</td>
                  <td className="whitespace-nowrap px-3 py-2">{ultima ? <>{ultima.numero}<span className="block text-xs text-slate-500">{f(ultima.emitida_at)}</span></> : ""}</td>
                  <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ETAPAS[r.etapa].cls}`}>{ETAPAS[r.etapa].label}</span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No hay solicitudes en esta vista.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
