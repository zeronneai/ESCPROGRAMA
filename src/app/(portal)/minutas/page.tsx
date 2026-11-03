import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { fechaMx, MINUTA_COLS, minutaEstado, type MinutaFirma, type MinutaRow } from "@/lib/minutas";
import { MINUTA_CREATORS } from "@/lib/ops/roles";
import { createClient } from "@/lib/supabase/server";

const VISTAS = { pendientes: "Por firmar", mias: "Las que hice", todas: "Todas" } as const;
type Vista = keyof typeof VISTAS;

export default async function Minutas({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: ms, error }, { data: fs }] = await Promise.all([
    supabase.from("minutas").select(MINUTA_COLS).order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    supabase.from("minuta_firmas").select("minuta_id, user_id, nombre, puesto, correo, firmada_at").limit(5000),
  ]);
  const minutas = (ms ?? []) as unknown as MinutaRow[];
  const firmas = (fs ?? []) as MinutaFirma[];
  const deMinuta = (id: string) => firmas.filter((f) => f.minuta_id === id);
  const porFirmar = minutas.filter((m) => m.estado === "enviada" && firmas.some((f) => f.minuta_id === m.id && f.user_id === u.id && !f.firmada_at));
  const mias = minutas.filter((m) => m.created_by === u.id);
  const canCreate = MINUTA_CREATORS.includes(u.rol);
  const ver: Vista = sp.ver && sp.ver in VISTAS ? (sp.ver as Vista) : porFirmar.length ? "pendientes" : canCreate ? "mias" : "todas";
  const rows = ver === "pendientes" ? porFirmar : ver === "mias" ? mias : minutas;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Minutas de reunión"
        subtitle="Lo que se acordó en cada junta, quién lo hace y para cuándo. Cada asistente la firma de enterado."
        actions={canCreate ? (
          <Link href="/minutas/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nueva minuta
          </Link>
        ) : undefined}
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudieron cargar las minutas: {error.message}</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Por firmar" value={porFirmar.length} tone={porFirmar.length ? "amber" : "default"} />
        {canCreate && <StatCard label="Hechas por mí" value={mias.length} hint={`${mias.filter((m) => m.estado === "borrador").length} en borrador`} />}
        <StatCard label="Total que puedo ver" value={minutas.length} />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {(Object.keys(VISTAS) as Vista[]).filter((k) => k !== "mias" || canCreate).map((k) => (
          <FilterChip key={k} href={`/minutas?ver=${k}`} active={ver === k}>{VISTAS[k]}{k === "pendientes" && porFirmar.length ? ` ${porFirmar.length}` : ""}</FilterChip>
        ))}
      </div>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title={ver === "pendientes" ? "No tienes minutas por firmar" : "Sin minutas"}>
            {canCreate && ver !== "pendientes" && "Haz la primera con el botón Nueva minuta."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((m) => {
              const f = deMinuta(m.id);
              const st = minutaEstado(m, f);
              const mine = f.find((x) => x.user_id === u.id);
              return (
                <li key={m.id}>
                  <Link href={`/minutas/${m.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        <span className="font-mono text-xs text-slate-500">{m.numero}</span>
                        <span className="truncate">{m.tema}</span>
                      </p>
                      <p className="text-xs text-slate-500">{fechaMx(m.fecha)} · {m.created_by_nombre} · {m.desarrollo?.length ?? 0} punto(s)</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {mine && m.estado === "enviada" && !mine.firmada_at && <Chip cls="bg-red-100 text-red-800">Te toca firmar</Chip>}
                      <Chip cls={st.cls}>{st.label}</Chip>
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
