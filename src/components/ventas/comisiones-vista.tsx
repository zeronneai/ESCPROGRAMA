import Link from "next/link";
import { DateTime } from "luxon";
import { ComisionesTabla } from "@/components/ventas/comisiones-tabla";
import { LeerImportes } from "@/components/ventas/leer-importes";
import { Card, FilterChip, PageHeader } from "@/components/ui";
import type { ComFactura, ComVendedor, ModoComisiones } from "@/lib/comisiones";
import { getBusinessSettings } from "@/lib/quotes/server";
import { PERIODS, periodRange, type Period } from "@/lib/stats/sales-summary";
import { createClient } from "@/lib/supabase/server";

type Ver = "pendientes" | "por_revisar" | "pagadas" | "por_cobrar" | "todas" | "revisadas";
type Campo = "pago" | "factura";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const fechaTxt = (d: string) => (d.startsWith("2000") || d.startsWith("2100") ? (d.startsWith("2000") ? "inicio" : "hoy") : new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }));

export type ComisionesParams = { p?: string; ver?: string; campo?: string; desde?: string; hasta?: string };

/**
 * Comisiones por vendedor y por factura.
 * - Jefa de ventas (y CEO, gerente): todos los vendedores, en /ventas/comisiones.
 * - Vendedor: solo las suyas, en /vendedor/comisiones (vendedorId).
 */
export async function ComisionesVista({ sp, ruta, modo, vendedorId }: { sp: ComisionesParams; ruta: string; modo: ModoComisiones; vendedorId?: string }) {
  const periodo = (PERIODS.some((x) => x.id === sp.p) ? sp.p : "mes") as Period;
  const opciones: { id: Ver; label: string }[] =
    modo === "gerente" ? [{ id: "revisadas", label: "Revisadas por la jefa" }]
    : modo === "jefa" ? [{ id: "por_revisar", label: "Por revisar" }, { id: "pendientes", label: "Pendientes" }, { id: "pagadas", label: "Pagadas" }, { id: "por_cobrar", label: "Por cobrar" }, { id: "todas", label: "Todas" }]
    : [{ id: "pendientes", label: "Pendientes" }, { id: "pagadas", label: "Pagadas" }, { id: "por_cobrar", label: "Por cobrar" }, { id: "todas", label: "Todas" }];
  const ver: Ver = opciones.find((o) => o.id === sp.ver)?.id ?? opciones[0].id;
  // Pendientes (pagadas sin comision completa) y por revisar: todas, sin importar la fecha.
  const sinFecha = ver === "pendientes" || ver === "por_revisar";
  // Por cobrar no tiene fecha de pago: se filtra por la fecha de la factura.
  const campo: Campo = ver === "por_cobrar" || sp.campo === "factura" ? "factura" : "pago";
  const propio = !!(sp.desde && FECHA.test(sp.desde)) || !!(sp.hasta && FECHA.test(sp.hasta));
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { from, to } = periodRange(periodo, DateTime.now().setZone(cfg.timezone));
  const d0 = propio ? (sp.desde && FECHA.test(sp.desde) ? sp.desde : "2000-01-01") : from.toISODate()!;
  const d1 = propio ? (sp.hasta && FECHA.test(sp.hasta) ? sp.hasta : "2100-12-31") : to.toISODate()!;
  const col = campo === "pago" ? "fecha_cobro" : "fecha";

  let q = supabase
    .from("ventas")
    .select("id, vendedor_id, factura, fecha, fecha_cobro, monto, moneda, porcentaje_cobrado, comision_revisada_at, customers(nombre), venta_lineas(id, descripcion, cantidad, importe, comision_pct, comision, articulos(clave))")
    .eq("tipo", "venta")
    .is("cancelada_at", null)
    .order("fecha", { ascending: false })
    .limit(5000);
  if (vendedorId) q = q.eq("vendedor_id", vendedorId);
  if (ver === "pagadas" || ver === "pendientes" || ver === "por_revisar") q = q.gte("porcentaje_cobrado", 100);
  if (ver === "por_cobrar") q = q.lt("porcentaje_cobrado", 100);
  if (ver === "revisadas") q = q.not("comision_revisada_at", "is", null);
  if (ver === "por_revisar") q = q.is("comision_revisada_at", null);
  if (!sinFecha) q = q.gte(col, d0).lte(col, d1);
  const [{ data, error }, { data: vends }] = await Promise.all([q, supabase.from("profiles").select("id, nombre").in("rol", ["vendedor", "jefe_ventas"])]);
  const nombres = new Map((vends ?? []).map((p) => [p.id as string, p.nombre as string]));

  type L = { id: string; descripcion: string; cantidad: string | null; importe: string | null; comision_pct: string | null; comision: string | null; articulos: { clave: string } | null };
  type V = { id: string; vendedor_id: string; factura: string | null; fecha: string; fecha_cobro: string | null; monto: string | null; moneda: string; porcentaje_cobrado: string; comision_revisada_at: string | null; customers: { nombre: string } | null; venta_lineas: L[] };
  const porVend = new Map<string, ComVendedor>();
  for (const v of (data ?? []) as unknown as V[]) {
    const lineas = (v.venta_lineas ?? []).map((l) => ({
      id: l.id, clave: l.articulos?.clave ?? null, descripcion: l.descripcion, cantidad: l.cantidad == null ? null : Number(l.cantidad),
      importe: l.importe == null ? null : Number(l.importe), pct: l.comision_pct == null ? null : Number(l.comision_pct), comision: l.comision == null ? null : Number(l.comision),
    }));
    const f: ComFactura = {
      id: v.id, factura: v.factura, cliente: v.customers?.nombre ?? "Cliente", fecha: v.fecha.slice(0, 10), fecha_cobro: v.fecha_cobro, moneda: v.moneda,
      monto: v.monto == null ? null : Number(v.monto), pagada: Number(v.porcentaje_cobrado) >= 100, revisada: !!v.comision_revisada_at, lineas,
      comision: lineas.reduce((a, l) => a + (l.comision ?? 0), 0), faltan: lineas.filter((l) => l.pct == null || l.importe == null).length,
    };
    if (ver === "pendientes" && !f.faltan) continue;
    if (ver === "por_revisar" && f.faltan) continue;
    const g = porVend.get(v.vendedor_id) ?? { id: v.vendedor_id, nombre: nombres.get(v.vendedor_id) ?? "Vendedor", facturas: [] };
    g.facturas.push(f);
    porVend.set(v.vendedor_id, g);
  }
  const vendedores = [...porVend.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const base: Record<string, string> = { p: periodo, ver, campo, ...(propio ? { desde: sp.desde ?? "", hasta: sp.hasta ?? "" } : {}) };
  const qs = (x: Record<string, string>) => {
    const o = { ...base, ...x };
    // Al elegir un periodo rapido se quita el rango propio.
    if ("p" in x) { delete o.desde; delete o.hasta; }
    return `${ruta}?${new URLSearchParams(o).toString()}`;
  };

  return (
    <div className="space-y-5">
      {modo === "vendedor" ? (
        <PageHeader title="Mis comisiones" subtitle="Pon la comisión de cada artículo de tus facturas (importe sin IVA × %). Pendientes = ventas ya pagadas a las que les falta comisión. Si una ya está pagada solo puedes llenar lo que falta; para corregir, avísale a la jefa de ventas." />
      ) : (
        <>
          <Link href="/ventas" className="text-sm text-slate-500 hover:text-slate-800">← Resumen de ventas</Link>
          <PageHeader
            title="Comisiones"
            subtitle={modo === "gerente" ? "Comisiones ya revisadas por la jefa de ventas: total por vendedor y por factura." : "Revisa la comisión de cada factura (puedes corregirla) y márcala como revisada: así le aparece a la gerente para pagarla."}
          />
        </>
      )}
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">{/comision_revisada/.test(error.message) ? "Falta correr la actualización 0074 en la base." : /comision/.test(error.message) ? "Falta correr la actualización 0072 en la base." : error.message}</Card>}
      <Card className="space-y-3 p-4">
        {opciones.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {opciones.map((o) => <FilterChip key={o.id} href={qs({ ver: o.id })} active={ver === o.id}>{o.label}</FilterChip>)}
          </div>
        )}
        {!sinFecha && <>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Filtrar por:</span>
          {ver !== "por_cobrar" && <FilterChip href={qs({ campo: "pago" })} active={campo === "pago"}>Fecha de pago</FilterChip>}
          <FilterChip href={qs({ campo: "factura" })} active={campo === "factura"}>Fecha de la factura</FilterChip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => <FilterChip key={p.id} href={qs({ p: p.id })} active={!propio && periodo === p.id}>{p.label}</FilterChip>)}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="ver" value={ver} />
          <input type="hidden" name="campo" value={campo} />
          <label className="text-xs font-medium text-slate-600">Desde<input type="date" name="desde" defaultValue={propio ? sp.desde : d0} className="block rounded border border-slate-300 px-2 py-1.5 text-sm" /></label>
          <label className="text-xs font-medium text-slate-600">Hasta<input type="date" name="hasta" defaultValue={propio ? sp.hasta : d1} className="block rounded border border-slate-300 px-2 py-1.5 text-sm" /></label>
          <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 font-medium text-white">Filtrar</button>
        </form>
        </>}
        <p className="text-xs text-slate-500">
          {ver === "pendientes" ? "Ventas ya pagadas a las que les falta la comisión de algún artículo (todas las fechas)."
            : ver === "por_revisar" ? "Ventas pagadas con la comisión completa que todavía no revisas (todas las fechas)."
            : `${ver === "pagadas" ? "Ventas cobradas al 100%" : ver === "por_cobrar" ? "Ventas que todavía no se cobran al 100% (su comisión puede cambiar)" : ver === "revisadas" ? "Comisiones revisadas" : "Todas las ventas"} con ${campo === "pago" ? "fecha de pago" : "fecha de factura"} del ${fechaTxt(d0)} al ${fechaTxt(d1)}.`}
        </p>
      </Card>
      {modo === "jefa" && !error && <LeerImportes />}
      <ComisionesTabla vendedores={vendedores} modo={modo} />
    </div>
  );
}
