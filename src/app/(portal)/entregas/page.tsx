import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ESTADO_SALIDA, SALIDA_COLS, SUBEN_FACTURA, type SalidaRow } from "@/lib/almacen";
import { fmtDate } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const VISTAS = { pendientes: "Por cargar", cargadas: "Cargadas", canceladas: "Canceladas", todas: "Todas" } as const;
type Vista = keyof typeof VISTAS;

export default async function Entregas({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const [{ data }, { data: lin }] = await Promise.all([
    supabase.from("salidas").select(SALIDA_COLS).order("created_at", { ascending: false }).limit(500),
    supabase.from("salida_lineas").select("salida_id, cantidad, escaneadas, articulo_id").limit(20000),
  ]);
  const all = (data ?? []) as SalidaRow[];
  const prog = new Map<string, { hechas: number; total: number }>();
  for (const l of lin ?? []) {
    if (!l.articulo_id) continue;
    const p = prog.get(l.salida_id) ?? { hechas: 0, total: 0 };
    p.hechas += l.escaneadas;
    p.total += l.cantidad;
    prog.set(l.salida_id, p);
  }
  const pend = all.filter((s) => s.estado === "por_cargar" || s.estado === "cargando");
  const ver: Vista = sp.ver && sp.ver in VISTAS ? (sp.ver as Vista) : "pendientes";
  const rows = ver === "pendientes" ? pend : ver === "cargadas" ? all.filter((s) => s.estado === "cargada") : ver === "canceladas" ? all.filter((s) => s.estado === "cancelada") : all;
  const alm = u.rol === "almacen" || u.rol === "supervisor_almacen";
  const sube = (SUBEN_FACTURA as readonly string[]).includes(u.rol);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Entregas"
        subtitle={alm ? "Facturas por cargar. Abre una y escanea cada caja al subirla al camión." : "Sube la factura y almacén la carga escaneando cada caja. Aquí ves si ya salió completa."}
        actions={sube ? (
          <Link href="/entregas/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Subir factura
          </Link>
        ) : undefined}
      />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Por cargar" value={pend.length} tone={pend.length ? "amber" : "default"} />
        <StatCard label="Cargadas hoy" value={all.filter((s) => s.estado === "cargada" && s.cargada_at && fmtDate(s.cargada_at, cfg.timezone, false) === fmtDate(new Date().toISOString(), cfg.timezone, false)).length} tone="green" />
        <StatCard label="Incompletas" value={all.filter((s) => s.incompleta).length} tone={all.some((s) => s.incompleta) ? "red" : "default"} />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {(Object.keys(VISTAS) as Vista[]).map((k) => (
          <FilterChip key={k} href={`/entregas?ver=${k}`} active={ver === k}>{VISTAS[k]}{k === "pendientes" && pend.length ? ` ${pend.length}` : ""}</FilterChip>
        ))}
      </div>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title={ver === "pendientes" ? "No hay facturas por cargar" : "Sin entregas"}>{sube && ver === "pendientes" && "Sube una con el botón Subir factura."}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => {
              const p = prog.get(s.id) ?? { hechas: 0, total: 0 };
              return (
                <li key={s.id}>
                  <Link href={`/entregas/${s.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        <span className="font-mono">{s.folio_factura}</span>
                        <span className="truncate font-normal text-slate-600">{s.cliente}</span>
                      </p>
                      <p className="text-xs text-slate-500">Subió {s.autor_nombre} · {fmtDate(s.created_at, cfg.timezone)}{s.notas ? ` · ${s.notas}` : ""}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.total > 0 && <span className="text-sm font-semibold text-slate-700">{p.hechas}/{p.total}</span>}
                      {s.incompleta && <Chip cls="bg-red-100 text-red-800">Incompleta</Chip>}
                      <Chip cls={ESTADO_SALIDA[s.estado].cls}>{ESTADO_SALIDA[s.estado].label}</Chip>
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
