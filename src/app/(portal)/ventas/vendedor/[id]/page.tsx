import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BitacoraList, type BitacoraListRow } from "@/components/bitacora-list";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireSalesViewer } from "@/lib/auth/sales";
import { BITACORA_SELECT } from "@/lib/bitacora/queries";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

type Tab = "ventas" | "prospeccion" | "solicitudes";

export default async function VendedorVentas({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; ver?: string }> }) {
  const viewer = await requireSalesViewer();
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "prospeccion" || sp.tab === "solicitudes" ? sp.tab : "ventas";
  const ver = sp.ver === "cerrados" ? "cerrados" : sp.ver === "todos" ? "todos" : "abiertos";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = DateTime.now().setZone(cfg.timezone);
  const today = now.toISODate()!;
  const { data: seller } = await supabase.from("profiles").select("id, nombre, correo, activo, rol").eq("id", id).maybeSingle();
  if (!seller || seller.rol !== "vendedor") notFound();

  const [{ data: b }, { data: reqs }, { count: movHoy }] = await Promise.all([
    supabase.from("bitacora").select(BITACORA_SELECT).eq("vendedor_id", id).is("archived_at", null).order("updated_at", { ascending: false }).limit(1000),
    supabase
      .from("quote_requests")
      .select("id, folio, submitted_at, customers:customers!quote_requests_customer_id_fkey(nombre), quote_issues!quote_issues_request_id_fkey(numero, emitida_at)")
      .eq("vendedor_id", id)
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(100),
    supabase.from("bitacora_eventos").select("id", { count: "exact", head: true }).eq("created_by", id).gte("created_at", now.startOf("day").toUTC().toISO()!),
  ]);
  const all = (b ?? []) as unknown as BitacoraListRow[];
  const ventas = all.filter((r) => r.customers?.tipo === "cliente");
  const prospeccion = all.filter((r) => r.customers?.tipo !== "cliente");
  const base = tab === "ventas" ? ventas : prospeccion;
  const rows = base.filter((r) => (ver === "todos" ? true : ver === "cerrados" ? r.resultado !== "abierta" : r.resultado === "abierta"));
  const seguimientos = all.filter((r) => r.resultado === "abierta" && r.proximo_seguimiento && r.proximo_seguimiento < today).length;
  const cartera = ventas.reduce((a, r) => a + (Number(r.cartera_dias_vencidos ?? 0) > 0 ? Number(r.cartera_monto ?? 0) : 0), 0);
  const requests = (reqs ?? []) as unknown as { id: string; folio: string; submitted_at: string; customers: { nombre: string } | null; quote_issues: { numero: string; emitida_at: string }[] }[];
  const link = (t: Tab, v?: string) => `/ventas/vendedor/${id}?tab=${t}${v ? `&ver=${v}` : ""}`;

  return (
    <div className="space-y-5">
      <Link href="/ventas" className="text-sm text-slate-500 hover:text-slate-800">← Resumen de ventas</Link>
      <PageHeader title={seller.nombre} subtitle={`${seller.correo}${seller.activo ? "" : " · inactivo"} · solo lectura`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Movimientos hoy" value={movHoy ?? 0} tone={(movHoy ?? 0) > 0 ? "green" : "amber"} />
        <StatCard label="Ventas en curso" value={ventas.filter((r) => r.resultado === "abierta").length} />
        <StatCard label="Prospectos activos" value={prospeccion.filter((r) => r.resultado === "abierta").length} />
        <StatCard label="Seguimientos vencidos" value={seguimientos} tone={seguimientos ? "red" : "default"} />
        <StatCard label="Cartera vencida" value={`$${Math.round(cartera).toLocaleString("es-MX")}`} tone={cartera ? "red" : "default"} />
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-flex">
        {([["ventas", `Ventas diarias ${ventas.length}`], ["prospeccion", `Prospección ${prospeccion.length}`], ["solicitudes", `Cotizaciones ${requests.length}`]] as const).map(([t, l]) => (
          <Link key={t} href={link(t)} className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-center ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>{l}</Link>
        ))}
      </div>

      {tab === "solicitudes" ? (
        <Card className="p-0">
          {requests.length === 0 ? (
            <EmptyState title="Sin solicitudes enviadas" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {requests.map((r) => {
                const last = [...r.quote_issues].sort((a, b) => b.emitida_at.localeCompare(a.emitida_at))[0];
                const inner = (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{r.folio} <span className="font-normal text-slate-600">· {r.customers?.nombre ?? "Cliente"}</span></p>
                      <p className="text-xs text-slate-500">Enviada a compras {DateTime.fromISO(r.submitted_at).setZone(cfg.timezone).setLocale("es-MX").toFormat("d LLL yyyy")}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${last ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>
                      {last ? `Cotización ${last.numero} enviada ${DateTime.fromISO(last.emitida_at).setZone(cfg.timezone).setLocale("es-MX").toFormat("d LLL")}` : "Sin enviar al cliente"}
                    </span>
                  </div>
                );
                return <li key={r.id}>{viewer.rol === "comprador" ? <Link href={`/comprador/solicitudes/${r.id}`} className="block hover:bg-slate-50">{inner}</Link> : inner}</li>;
              })}
            </ul>
          )}
        </Card>
      ) : (
        <>
          <div className="flex gap-2">
            <FilterChip href={link(tab)} active={ver === "abiertos"}>En proceso</FilterChip>
            <FilterChip href={link(tab, "cerrados")} active={ver === "cerrados"}>Cerrados</FilterChip>
            <FilterChip href={link(tab, "todos")} active={ver === "todos"}>Todos</FilterChip>
          </div>
          <Card className="p-0">
            <BitacoraList rows={rows} hrefFor={(bid) => `/ventas/bitacora/${bid}`} today={today} />
          </Card>
        </>
      )}
    </div>
  );
}
