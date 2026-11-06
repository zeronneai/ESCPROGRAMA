import Link from "next/link";
import { DateTime } from "luxon";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth/guards";
import { cargarTablero, type Metrica, type Tono } from "@/lib/inicio";
import { ROL_LABEL } from "@/lib/ops/roles";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TONO: Record<Tono, string> = {
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  green: "bg-green-50 text-green-800 ring-green-200",
  default: "bg-slate-50 text-slate-800 ring-slate-200",
};

/** Accesos rapidos por puesto. */
const ACCESOS: Partial<Record<string, { href: string; label: string }[]>> = {
  vendedor: [
    { href: "/vendedor/solicitudes/nueva", label: "Nueva solicitud" },
    { href: "/vendedor/bitacora/venta/factura", label: "Registrar venta con factura (PDF)" },
    { href: "/vendedor/bitacora/venta/nueva", label: "Venta sin factura" },
    { href: "/vendedor/bitacora/venta/nueva?tipo=visita", label: "Visita sin venta" },
    { href: "/guias/nueva", label: "Pedir guía" },
  ],
  comprador: [
    { href: "/comprador", label: "Cotizar pendientes" },
    { href: "/pagos/oc/nueva", label: "Nueva OC" },
    { href: "/comprador/proveedores", label: "Proveedores" },
  ],
  jefe_ventas: [
    { href: "/ventas", label: "Resumen de ventas" },
    { href: "/consumo", label: "Aprobar consumo" },
  ],
  ceo: [
    { href: "/pagos?ver=por_pagar", label: "Pagos por hacer" },
    { href: "/ventas", label: "Ventas" },
    { href: "/indicadores", label: "Indicadores" },
  ],
  gerente: [
    { href: "/ventas", label: "Ventas" },
    { href: "/indicadores", label: "Indicadores" },
  ],
  coordinador_iso: [
    { href: "/calidad/sac/nueva", label: "Acción correctiva" },
    { href: "/calidad/cambios/nuevo", label: "Registrar cambio" },
    { href: "/documentos", label: "Documentos" },
  ],
  marketplaces: [{ href: "/guias", label: "Guías por atender" }],
  almacen: [{ href: "/evaluaciones/proveedores", label: "Evaluar proveedores" }],
  supervisor_almacen: [{ href: "/evaluaciones/proveedores", label: "Evaluar proveedores" }, { href: "/minutas/nueva", label: "Nueva minuta" }],
  supervisor_finanzas: [{ href: "/minutas/nueva", label: "Nueva minuta" }, { href: "/documentos", label: "Documentos" }],
};

function Dato({ m, href }: { m: Metrica; href: string }) {
  return (
    <Link prefetch={false} href={m.href ?? href} className={`block rounded-lg px-3 py-2.5 ring-1 transition hover:brightness-95 ${TONO[m.tono ?? "default"]}`}>
      <p className="text-xs opacity-80">{m.label}</p>
      <p className="text-xl font-semibold leading-tight">{m.valor}</p>
      {m.hint && <p className="truncate text-[11px] opacity-75">{m.hint}</p>}
    </Link>
  );
}

/** Tablero de inicio: lo urgente arriba y un resumen por seccion segun el puesto. */
export default async function Inicio() {
  const u = await requireUser();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const t = await cargarTablero(supabase, u.id, u.rol, cfg.timezone);
  const now = DateTime.now().setZone(cfg.timezone).setLocale("es-MX");
  const saludo = now.hour < 12 ? "Buenos días" : now.hour < 19 ? "Buenas tardes" : "Buenas noches";
  const accesos = ACCESOS[u.rol] ?? [];
  const rojas = t.alertas.filter((a) => a.tono === "red").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{now.toFormat("cccc d 'de' LLLL")} · {ROL_LABEL[u.rol]}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{saludo}, {u.nombre.split(" ")[0]}</h1>
        </div>
        {accesos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {accesos.map((a, i) => (
              <Link key={a.href} href={a.href} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${i === 0 ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
                {i === 0 && <Icon name="plus" className="h-4 w-4" />}
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <section className={`rounded-xl border p-4 ${rojas ? "border-red-200 bg-red-50/60" : t.alertas.length ? "border-amber-200 bg-amber-50/50" : "border-green-200 bg-green-50/60"}`}>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
          <Icon name="alert" className="h-4 w-4" /> {t.alertas.length ? `Requiere tu atención (${t.alertas.length})` : "Todo al día"}
        </h2>
        {t.alertas.length === 0 ? (
          <p className="text-sm text-green-800">No tienes pendientes urgentes. Revisa el resumen de abajo.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {t.alertas.map((a) => (
              <li key={a.texto}>
                <Link prefetch={false} href={a.href} className={`flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5 text-sm shadow-sm ring-1 hover:bg-slate-50 ${a.tono === "red" ? "ring-red-200" : "ring-amber-200"}`}>
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.tono === "red" ? "bg-red-600" : "bg-amber-500"}`} />
                    <span className="text-slate-800">{a.texto}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-brand-700">Ver</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {t.secciones.map((s) => (
          <section key={s.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon name={s.icon} className="h-4 w-4" /></span>
                {s.titulo}
              </h2>
              <Link prefetch={false} href={s.href} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Ver detalle</Link>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {s.metricas.map((m) => <Dato key={m.label} m={m} href={s.href} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
