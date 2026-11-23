import Link from "next/link";
import { DateTime } from "luxon";
import { ComisionesTabla } from "@/components/ventas/comisiones-tabla";
import { Card, FilterChip, PageHeader } from "@/components/ui";
import type { ComFactura, ComVendedor } from "@/lib/comisiones";
import { getBusinessSettings } from "@/lib/quotes/server";
import { PERIODS, periodRange, type Period } from "@/lib/stats/sales-summary";
import { createClient } from "@/lib/supabase/server";

type Ver = "pagadas" | "por_cobrar" | "todas";
type Campo = "pago" | "factura";
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const fechaTxt = (d: string) => (d.startsWith("2000") || d.startsWith("2100") ? (d.startsWith("2000") ? "inicio" : "hoy") : new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }));

export type ComisionesParams = { p?: string; ver?: string; campo?: string; desde?: string; hasta?: string };

/**
 * Comisiones por vendedor y por factura.
 * - Jefa de ventas (y CEO, gerente): todos los vendedores, en /ventas/comisiones.
 * - Vendedor: solo las suyas, en /vendedor/comisiones (vendedorId).
 */
export async function ComisionesVista({ sp, ruta, vendedorId }: { sp: ComisionesParams; ruta: string; vendedorId?: string }) {
  const periodo = (PERIODS.some((x) => x.id === sp.p) ? sp.p : "mes") as Period;
  const ver: Ver = sp.ver === "por_cobrar" || sp.ver === "todas" ? sp.ver : "pagadas";
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
    .select("id, vendedor_id, factura, fecha, fecha_cobro, monto, moneda, porcentaje_cobrado, customers(nombre), venta_lineas(id, descripcion, cantidad, importe, comision_pct, comision, articulos(clave))")
    .eq("tipo", "venta")
    .is("cancelada_at", null)
    .order("fecha", { ascending: false })
    .limit(5000);
  if (vendedorId) q = q.eq("vendedor_id", vendedorId);
  if (ver === "pagadas") q = q.gte("porcentaje_cobrado", 100);
  if (ver === "por_cobrar") q = q.lt("porcentaje_cobrado", 100);
  q = q.gte(col, d0).lte(col, d1);
  const [{ data, error }, { data: vends }] = await Promise.all([q, supabase.from("profiles").select("id, nombre").in("rol", ["vendedor", "jefe_ventas"])]);
  const nombres = new Map((vends ?? []).map((p) => [p.id as string, p.nombre as string]));

  type L = { id: string; descripcion: string; cantidad: string | null; importe: string | null; comision_pct: string | null; comision: string | null; articulos: { clave: string } | null };
  type V = { id: string; vendedor_id: string; factura: string | null; fecha: string; fecha_cobro: string | null; monto: string | null; moneda: string; porcentaje_cobrado: string; customers: { nombre: string } | null; venta_lineas: L[] };
  const porVend = new Map<string, ComVendedor>();
  for (const v of (data ?? []) as unknown as V[]) {
    const lineas = (v.venta_lineas ?? []).map((l) => ({
      id: l.id, clave: l.articulos?.clave ?? null, descripcion: l.descripcion, cantidad: l.cantidad == null ? null : Number(l.cantidad),
      importe: l.importe == null ? null : Number(l.importe), pct: l.comision_pct == null ? null : Number(l.comision_pct), comision: l.comision == null ? null : Number(l.comision),
    }));
    const f: ComFactura = {
      id: v.id, factura: v.factura, cliente: v.customers?.nombre ?? "Cliente", fecha: v.fecha.slice(0, 10), fecha_cobro: v.fecha_cobro, moneda: v.moneda,
      monto: v.monto == null ? null : Number(v.monto), pagada: Number(v.porcentaje_cobrado) >= 100, lineas,
      comision: lineas.reduce((a, l) => a + (l.comision ?? 0), 0), faltan: lineas.filter((l) => l.pct == null || l.importe == null).length,
    };
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
      {vendedorId ? (
        <PageHeader title="Mis comisiones" subtitle="Comisión por artículo de cada factura: importe sin IVA × %. Pesos y dólares por separado. Si alguna está mal y la venta ya está pagada, avísale a la jefa de ventas: solo ella la puede corregir." />
      ) : (
        <>
          <Link href="/ventas" className="text-sm text-slate-500 hover:text-slate-800">← Resumen de ventas</Link>
          <PageHeader title="Comisiones" subtitle="Comisión por artículo de cada factura: importe sin IVA × %. Pesos y dólares por separado." />
        </>
      )}
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">{/comision/.test(error.message) ? "Falta correr la actualización 0072 en la base." : error.message}</Card>}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <FilterChip href={qs({ ver: "pagadas" })} active={ver === "pagadas"}>Pagadas</FilterChip>
          <FilterChip href={qs({ ver: "por_cobrar" })} active={ver === "por_cobrar"}>Por cobrar</FilterChip>
          <FilterChip href={qs({ ver: "todas" })} active={ver === "todas"}>Todas</FilterChip>
        </div>
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
        <p className="text-xs text-slate-500">
          {ver === "pagadas" ? "Ventas cobradas al 100%" : ver === "por_cobrar" ? "Ventas que todavía no se cobran al 100% (su comisión puede cambiar)" : "Todas las ventas"}
          {` con ${campo === "pago" ? "fecha de pago" : "fecha de factura"} del ${fechaTxt(d0)} al ${fechaTxt(d1)}.`}
        </p>
      </Card>
      <ComisionesTabla vendedores={vendedores} propio={!!vendedorId} />
    </div>
  );
}
