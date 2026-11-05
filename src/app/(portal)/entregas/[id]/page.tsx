import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelarEntrega, CargaPanel } from "@/components/almacen/carga-panel";
import { Chip, Dl } from "@/components/ops-ui";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ESTADO_SALIDA, SALIDA_COLS, type SalidaLinea, type SalidaRow } from "@/lib/almacen";
import { fmtDate, fmtDay } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

type Log = { id: number; codigo: string; ok: boolean; accion: string; mensaje: string | null; user_nombre: string | null; created_at: string };

export default async function Entrega({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const [{ data: s }, { data: lin }, { data: log }, { data: ets }] = await Promise.all([
    supabase.from("salidas").select(SALIDA_COLS).eq("id", id).maybeSingle(),
    supabase.from("salida_lineas").select("id, orden, articulo_id, clave, descripcion, unidad, cantidad, escaneadas").eq("salida_id", id).order("orden"),
    supabase.from("salida_escaneos").select("id, codigo, ok, accion, mensaje, user_nombre, created_at").eq("salida_id", id).order("created_at", { ascending: false }).limit(60),
    supabase.from("etiquetas").select("codigo, articulos(clave)").eq("salida_id", id).eq("estado", "cargada").order("salida_at", { ascending: false }),
  ]);
  if (!s) notFound();
  const sal = s as SalidaRow;
  const lineas = (lin ?? []) as SalidaLinea[];
  const logs = (log ?? []) as Log[];
  const alm = u.rol === "almacen" || u.rol === "supervisor_almacen";
  const abierta = sal.estado === "por_cargar" || sal.estado === "cargando";
  const rechazos = logs.filter((l) => !l.ok).length;
  const cargadas = ((ets ?? []) as unknown as { codigo: string; articulos: { clave: string } | null }[]).map((e) => ({ codigo: e.codigo, clave: e.articulos?.clave ?? "" }));
  return (
    <div className="space-y-4">
      <Link href="/entregas" className="text-sm text-slate-500 hover:text-slate-800">← Entregas</Link>
      <PageHeader
        title={`Factura ${sal.folio_factura}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Chip cls={ESTADO_SALIDA[sal.estado].cls}>{ESTADO_SALIDA[sal.estado].label}</Chip>{sal.incompleta && <Chip cls="bg-red-100 text-red-800">Incompleta</Chip>}{sal.espera && abierta && <Chip cls="bg-orange-100 text-orange-800">En espera: sin material</Chip>}{sal.cliente}</span>}
        actions={
          <div className="flex flex-wrap gap-2 text-sm">
            {sal.factura_path && <a href={`/api/facturas/${id}`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">Ver factura PDF</a>}
            {sal.xml_path && <a href={`/api/facturas/${id}?tipo=xml`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50">XML</a>}
          </div>
        }
      />
      {sp.nueva && <Alert tone="success">Factura enviada a almacén. Te avisamos cuando quede cargada.</Alert>}
      {sal.notas && <Alert tone="info">Nota para almacén: {sal.notas}</Alert>}
      {!alm && sal.espera && abierta && <Alert tone="error"><span className="font-semibold">Almacén no puede surtir por falta de material:</span> {sal.espera_nota} <span className="text-xs">({[sal.espera_nombre, sal.espera_at ? fmtDate(sal.espera_at, cfg.timezone) : null].filter(Boolean).join(" · ")})</span></Alert>}
      {sal.venta_id && !alm && <p className="text-sm"><Link href={u.rol === "vendedor" ? `/vendedor/bitacora/venta/${sal.venta_id}` : `/ventas/venta/${sal.venta_id}`} className="text-brand-700 underline">Ver la venta registrada con esta factura</Link></p>}
      {alm && abierta ? (
        <CargaPanel salidaId={id} lineas={lineas} cargadas={cargadas} espera={sal.espera ? { nota: sal.espera_nota, nombre: sal.espera_nombre, fecha: sal.espera_at ? fmtDate(sal.espera_at, cfg.timezone) : null } : null} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {lineas.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-500">{l.clave ?? "Sin clave"}</p>
                  <p className="text-sm text-slate-900">{l.descripcion}</p>
                </div>
                <span className={`shrink-0 text-sm font-semibold ${l.articulo_id && l.escaneadas < l.cantidad ? "text-amber-700" : "text-slate-800"}`}>
                  {l.articulo_id ? `${l.escaneadas}/${l.cantidad}` : `${l.cantidad} (no se escanea)`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="p-4">
        <Dl
          items={[
            ["Fecha de la factura", fmtDay(sal.fecha_factura)],
            ["Vendedor en la factura", sal.vendedor_factura ?? ""],
            ["Subió", `${sal.autor_nombre ?? ""} · ${fmtDate(sal.created_at, cfg.timezone)}`],
            ["Cargó", sal.cargada_at ? `${sal.cargada_nombre ?? ""} · ${fmtDate(sal.cargada_at, cfg.timezone)}` : ""],
            [sal.estado === "cancelada" ? "Motivo de cancelación" : "Nota al cerrar", sal.cierre_nota ?? ""],
          ]}
        />
      </Card>
      {!alm && ((sal.estado === "por_cargar" && sal.created_by === u.id) || (abierta && u.rol === "jefe_ventas")) && <CancelarEntrega salidaId={id} />}
      {logs.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-800">Registro de escaneos ({logs.length}){rechazos ? ` · ${rechazos} rechazado(s)` : ""}</summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span><span className={`mr-2 font-bold ${l.ok ? "text-green-700" : "text-red-700"}`}>{l.ok ? (l.accion === "quitar" ? "↩" : "✓") : "✗"}</span><span className="font-mono">{l.codigo}</span> <span className="text-slate-600">{l.mensaje}</span></span>
                <span className="text-xs text-slate-500">{l.user_nombre} · {fmtDate(l.created_at, cfg.timezone)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
