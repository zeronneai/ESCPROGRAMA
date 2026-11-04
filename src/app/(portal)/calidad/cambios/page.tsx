import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { CAMBIO_COLS, docNombre, ESTADOS_CAMBIO, TIPOS_CAMBIO, type CambioRow } from "@/lib/documentos";
import { fmtDay } from "@/lib/ops/server";
import { createClient } from "@/lib/supabase/server";

export default async function ControlCambios({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await requireRoles(["coordinador_iso", "gerente", "ceo", "comprador"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("control_cambios").select(CAMBIO_COLS).order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  const all = (data ?? []) as unknown as CambioRow[];
  const ver = sp.ver === "en_proceso" || sp.ver === "implementado" ? sp.ver : "todos";
  const rows = ver === "todos" ? all : all.filter((c) => c.estado === ver);
  const iso = u.rol === "coordinador_iso";
  return (
    <div className="space-y-5">
      <Link href="/calidad" className="text-sm text-slate-500 hover:text-slate-800">← Calidad</Link>
      <PageHeader
        title="Control de cambios"
        subtitle={iso ? "Registro de cambios a documentos y procesos. La gerente y el comprador lo consultan y reciben aviso de cada cambio." : "Cambios a documentos y procesos registrados por el Coordinador ISO. Solo consulta."}
        actions={iso ? (
          <Link href="/calidad/cambios/nuevo" className="inline-flex items-center gap-1.5 rounded-md bg-purple-700 px-3 py-2 text-sm font-medium text-white hover:bg-purple-800">
            <Icon name="plus" className="h-4 w-4" /> Registrar cambio
          </Link>
        ) : undefined}
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar: {error.message}</Card>}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Cambios registrados" value={all.length} />
        <StatCard label="En proceso" value={all.filter((c) => c.estado === "en_proceso").length} tone={all.some((c) => c.estado === "en_proceso") ? "amber" : "default"} />
        <StatCard label="Implementados" value={all.filter((c) => c.estado === "implementado").length} tone="green" />
      </div>
      <div className="flex gap-2">
        {([["todos", "Todos"], ["en_proceso", "En proceso"], ["implementado", "Implementados"]] as const).map(([k, l]) => (
          <FilterChip key={k} href={k === "todos" ? "/calidad/cambios" : `/calidad/cambios?ver=${k}`} active={ver === k}>{l}</FilterChip>
        ))}
      </div>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="Sin cambios registrados">{iso && "Registra el primero con el botón Registrar cambio."}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/calidad/cambios/${c.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      <span className="font-mono text-xs text-slate-500">{c.numero}</span>
                      <span className="truncate">{docNombre(c.documentos, c.documento_texto)}</span>
                    </p>
                    <p className="truncate text-xs text-slate-600">{c.descripcion}</p>
                    <p className="text-xs text-slate-500">{fmtDay(c.fecha)} · {TIPOS_CAMBIO[c.tipo]}{c.version_nueva ? ` · v${c.version_anterior ?? "?"} a v${c.version_nueva}` : ""}</p>
                  </div>
                  <Chip cls={ESTADOS_CAMBIO[c.estado].cls}>{ESTADOS_CAMBIO[c.estado].label}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
