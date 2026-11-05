import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { elapsedText, GUIA_ESTADOS, guiaAlert, guiaTitle, hoursPending, type GuiaEstado } from "@/lib/ops/guias";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string; numero: string; factura: string; destinatario: string; paqueteria: string; paqueteria_otra: string | null; estado: GuiaEstado;
  solicitada_at: string; lista_at: string | null; vendedor_nombre: string | null; atendida_nombre: string | null; urgente: boolean;
  recordatorios: number; numero_rastreo: string | null; created_at: string; vendedor_id: string;
};
const VIEWS = { pendientes: "Pendientes", listas: "Listas", todas: "Todas" } as const;

export default async function Guias({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const ver = (sp.ver && sp.ver in VIEWS ? sp.ver : "pendientes") as keyof typeof VIEWS;
  const qq = (sp.q ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data, error } = await supabase
    .from("guias")
    .select("id, numero, factura, destinatario, paqueteria, paqueteria_otra, estado, solicitada_at, lista_at, vendedor_nombre, atendida_nombre, urgente, recordatorios, numero_rastreo, created_at, vendedor_id")
    .order("created_at", { ascending: false })
    .limit(500);
  const all = (data ?? []) as Row[];
  const now = new Date();
  const isSeller = u.rol === "vendedor";
  const isMkt = u.rol === "marketplaces";
  const pendientes = all.filter((g) => ["solicitada", "en_proceso", "requiere_datos"].includes(g.estado));
  const rows = (ver === "pendientes" ? pendientes : ver === "listas" ? all.filter((g) => g.estado === "lista") : all)
    .filter((g) => !qq || [g.factura, g.destinatario, g.paqueteria, g.numero, g.vendedor_nombre, g.numero_rastreo].some((f) => f?.toLowerCase().includes(qq)))
    .sort((a, b) =>
      ver !== "pendientes"
        ? b.created_at.localeCompare(a.created_at)
        : Number(b.estado === "requiere_datos" && isSeller) - Number(a.estado === "requiere_datos" && isSeller) ||
          Number(b.urgente) - Number(a.urgente) ||
          a.solicitada_at.localeCompare(b.solicitada_at),
    );
  const vencidas = pendientes.filter((g) => guiaAlert(g, now) === "roja").length;
  const conAlarma = pendientes.filter((g) => guiaAlert(g, now) === "ambar").length;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: cfg.timezone });
  const listasHoy = all.filter((g) => g.lista_at && new Date(g.lista_at).toLocaleDateString("en-CA", { timeZone: cfg.timezone }) === today).length;
  const done = all.filter((g) => g.lista_at).slice(0, 50);
  const avgH = done.length ? done.reduce((a, g) => a + (new Date(g.lista_at!).getTime() - new Date(g.created_at).getTime()) / 3_600_000, 0) / done.length : null;
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ver: ver === "pendientes" ? undefined : ver, q: sp.q, ...o })) if (v) p.set(k, v);
    return `/guias${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Guías de paquetería"
        subtitle={isMkt ? "Solicitudes de los vendedores. Toma la guía, genérala y súbela aquí." : isSeller ? "Pide la guía a Marketplaces y descárgala aquí cuando esté lista." : "Seguimiento de las guías de todos los vendedores (solo lectura)."}
        actions={isSeller && (
          <Link href="/guias/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Pedir guía
          </Link>
        )}
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudieron cargar las guías: {error.message}</Card>}
      <AutoRefresh segundos={60} />
      {vencidas > 0 && (
        <div className="flex animate-pulse items-center gap-3 rounded-lg border-2 border-red-700 bg-red-600 px-4 py-3 text-sm text-white shadow-lg">
          <Icon name="alert" className="h-6 w-6 shrink-0" />
          <span className="text-base"><strong>{vencidas} guía(s) con más de 2 horas</strong> sin resolverse. Atiéndelas ya.</span>
        </div>
      )}
      {vencidas === 0 && conAlarma > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Icon name="alert" className="h-5 w-5 shrink-0" />
          <span><strong>{conAlarma}</strong> guía(s) llevan más de 1 hora. A las 2 horas se ponen en rojo.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={isMkt ? "Por atender" : "Pendientes"} value={pendientes.filter((g) => g.estado !== "requiere_datos").length} tone={pendientes.length ? "amber" : "default"} />
        <StatCard label="Faltan datos" value={pendientes.filter((g) => g.estado === "requiere_datos").length} tone={pendientes.some((g) => g.estado === "requiere_datos") ? "red" : "default"} hint={isSeller ? "Corrígelas para que avancen" : undefined} />
        <StatCard label="Más de 2 horas" value={vencidas} tone={vencidas ? "red" : "default"} />
        <StatCard label="Listas hoy" value={listasHoy} tone={listasHoy ? "green" : "default"} hint={avgH !== null ? `Promedio ${elapsedText(avgH)} por guía` : undefined} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {Object.entries(VIEWS).map(([k, l]) => (
            <FilterChip key={k} href={href({ ver: k === "pendientes" ? undefined : k })} active={ver === k}>{l}{k === "pendientes" ? ` ${pendientes.length}` : ""}</FilterChip>
          ))}
        </div>
        <form method="get" className="flex gap-2">
          {ver !== "pendientes" && <input type="hidden" name="ver" value={ver} />}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Factura, cliente, rastreo" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm sm:w-64" />
        </form>
      </div>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title={ver === "pendientes" ? "No hay guías pendientes" : "Sin guías en esta vista"} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((g) => {
              const st = GUIA_ESTADOS[g.estado];
              const alert = guiaAlert(g, now);
              const h = hoursPending(g, now);
              return (
                <li key={g.id}>
                  <Link href={`/guias/${g.id}`} className={`flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${alert === "roja" ? "border-l-8 border-red-600 bg-red-100 hover:bg-red-200" : alert === "ambar" ? "border-l-4 border-amber-500 bg-amber-50 hover:bg-amber-100" : "hover:bg-slate-50"}`}>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        <span className="truncate">{guiaTitle(g)}</span>
                        {g.urgente && <Chip cls="bg-red-600 text-white">URGENTE</Chip>}
                        {alert === "roja" && <Chip cls="animate-pulse bg-red-700 text-white">ATRASADA +2 h</Chip>}
                        {alert === "ambar" && <Chip cls="bg-amber-500 text-white">+1 h</Chip>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {g.numero}
                        {!isSeller && g.vendedor_nombre && ` · Pide ${g.vendedor_nombre}`}
                        {g.atendida_nombre && ` · Atiende ${g.atendida_nombre}`}
                        {g.numero_rastreo && ` · Rastreo ${g.numero_rastreo}`}
                        {g.recordatorios > 0 && ` · ${g.recordatorios} recordatorio(s)`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {h !== null && <span className={alert === "roja" ? "text-sm font-bold text-red-700" : alert === "ambar" ? "font-semibold text-amber-700" : "text-slate-500"}>Hace {elapsedText(h)}</span>}
                      <Chip cls={st.chip}>{st.label}</Chip>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
