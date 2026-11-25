import { Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import Link from "next/link";
import { ConfigMetasVenta, type MetaFila } from "@/components/metas/config-metas-venta";
import { LeerSubtotales } from "@/components/ventas/leer-subtotales";
import { ConfigPeriodo } from "@/components/metas/config-periodo";
import { ConfigMeta, TipoVendedor } from "@/components/prospeccion/config-meta";
import { requireRoles } from "@/lib/auth/sales";
import { TIPOS_PROSPECCION, type AvanceProspeccion, type TipoProspeccion } from "@/lib/meta-prospeccion";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fecha = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });

/** Meta diaria de prospeccion: la jefa la configura; gerente y CEO la consultan. */
export default async function MetaProspeccion() {
  const u = await requireRoles(["jefe_ventas", "gerente", "ceo"]);
  const edita = u.rol === "jefe_ventas";
  const supabase = await createClient();
  const [{ data: cfg, error }, { data: av }, { data: metasV, error: errMetas }, { data: usuarios }] = await Promise.all([
    supabase.from("prospeccion_config").select("meta_telemarketing, meta_campo, inicio").eq("id", 1).maybeSingle(),
    supabase.rpc("prospeccion_avance"),
    supabase.from("metas_venta").select("id, nombre, vendedor_id, capturista_id, meta, estado").order("orden").order("nombre"),
    supabase.from("profiles").select("id, nombre").in("rol", ["vendedor", "jefe_ventas"]).eq("activo", true).order("nombre"),
  ]);
  const { data: mcfg } = await supabase.from("metas_config").select("desde, hasta").eq("id", 1).maybeSingle();
  const { count: estimados } = edita
    ? await supabase.from("ventas").select("id", { count: "exact", head: true }).eq("subtotal_estimado", true).is("cancelada_at", null).or("factura_path.not.is.null,xml_path.not.is.null")
    : { count: null };
  if (error || !cfg)
    return (
      <div className="space-y-4">
        <PageHeader title="Meta de prospección" />
        <EmptyState title="Falta la actualización de la base">Corre <code>0079_meta_prospeccion.sql</code> en el SQL Editor de Supabase.</EmptyState>
      </div>
    );
  const filas = (av ?? []) as AvanceProspeccion[];
  const grupos: TipoProspeccion[] = ["telemarketing", "campo", "sin_meta"];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Metas"
        subtitle={`Metas mensuales de venta y meta diaria de prospección. Prospectos nuevos que cada vendedor debe registrar por día, de lunes a viernes, contando desde el ${fecha(cfg.inicio)}. Es acumulativa: lo que no registraron en días pasados se queda pendiente.`}
      />
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Metas mensuales de venta</h2>
          <Link href="/metas" className="text-sm font-medium text-brand-700 underline">Ver gráficas en vivo →</Link>
        </div>
        {errMetas ? (
          <p className="text-sm text-amber-800">Falta correr <code>0080_metas_ventas.sql</code> en Supabase.</p>
        ) : (
          <ConfigMetasVenta metas={((metasV ?? []) as MetaFila[]).map((m) => ({ ...m, meta: Number(m.meta) }))} usuarios={(usuarios ?? []) as { id: string; nombre: string }[]} edita={edita} />
        )}
        {mcfg ? <ConfigPeriodo desde={mcfg.desde} hasta={mcfg.hasta} edita={edita} /> : !errMetas && <p className="text-sm text-amber-800">Para el periodo proporcional y el link de las pantallas falta correr <code>0081_metas_periodo_publico.sql</code>.</p>}
        {edita && estimados != null && <LeerSubtotales pendientes={estimados} />}
        <p className="text-xs text-slate-500">El avance es lo registrado en Ventas diarias del mes por ese usuario, sin IVA. Para una meta sin usuario (como José Ortiz), elige quién captura sus ventas: esa persona (y tú) las sube a mano en el menú, Capturar ventas. Una meta en pausa no sale en las gráficas.</p>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Meta diaria de prospección</h2>
        {edita ? (
          <ConfigMeta tele={cfg.meta_telemarketing} campo={cfg.meta_campo} inicio={cfg.inicio} />
        ) : (
          <p className="text-sm text-slate-700">Telemarketing: <b>{cfg.meta_telemarketing}</b> por día · Campo: <b>{cfg.meta_campo}</b> por día · desde el {fecha(cfg.inicio)}. La cambia la jefa de ventas.</p>
        )}
        {edita && <p className="text-xs text-slate-500">Cambia el tipo de cada vendedor en las tablas de abajo. Los vendedores ven un aviso rojo con lo que les falta y una ventana una vez al día.</p>}
      </Card>

      {grupos.map((g) => {
        const fs = filas.filter((f) => f.tipo === g);
        if (!fs.length) return null;
        const req = fs.reduce((s, f) => s + f.requeridos, 0);
        const reg = fs.reduce((s, f) => s + f.registrados, 0);
        const falt = fs.reduce((s, f) => s + f.faltan, 0);
        return (
          <section key={g} className="space-y-3">
            <h2 className="text-base font-semibold">{TIPOS_PROSPECCION[g]} <span className="text-sm font-normal text-slate-500">({fs.length})</span></h2>
            {g !== "sin_meta" && (
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Meta acumulada" value={req} />
                <StatCard label="Registrados" value={reg} tone={reg >= req ? "green" : "default"} />
                <StatCard label="Faltan" value={falt} tone={falt ? "red" : "green"} />
              </div>
            )}
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Vendedor</th>
                    <th className="px-3 py-2.5 text-right">Hoy</th>
                    <th className="px-3 py-2.5 text-right">Registrados</th>
                    <th className="px-3 py-2.5 text-right">Meta acumulada</th>
                    <th className="px-3 py-2.5 text-right">Faltan</th>
                    <th className="px-3 py-2.5 text-right">Avance</th>
                    <th className="px-4 py-2.5">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fs.map((f) => {
                    const pct = f.requeridos ? Math.min(100, Math.round((f.registrados / f.requeridos) * 100)) : null;
                    return (
                      <tr key={f.vendedor_id}>
                        <td className="px-4 py-2.5 font-medium">{f.nombre}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${f.meta_hoy && f.hoy < f.meta_hoy ? "text-red-700" : ""}`}>{f.meta_hoy ? `${f.hoy} / ${f.meta_hoy}` : f.hoy}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{f.registrados}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{g === "sin_meta" ? "-" : f.requeridos}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${f.faltan ? "text-red-700" : "text-green-700"}`}>{g === "sin_meta" ? "-" : f.faltan}</td>
                        <td className="px-3 py-2.5 text-right">
                          {pct === null ? "-" : (
                            <span className="inline-flex items-center gap-2 tabular-nums">
                              {pct}%
                              <span className="inline-block h-2 w-20 overflow-hidden rounded-full bg-slate-200"><span className={`block h-2 ${pct >= 100 ? "bg-green-600" : "bg-red-500"}`} style={{ width: `${pct}%` }} /></span>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{edita ? <TipoVendedor id={f.vendedor_id} tipo={f.tipo} /> : TIPOS_PROSPECCION[f.tipo]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </section>
        );
      })}
      {!filas.length && <EmptyState title="No hay vendedores activos" />}
      <p className="text-xs text-slate-500">Cuentan los prospectos que el vendedor registró en Prospección desde la fecha de inicio (aunque después se cierren o archiven). Los que llegan del sitio web no cuentan. Sábados y domingos no suman meta.</p>
    </div>
  );
}
