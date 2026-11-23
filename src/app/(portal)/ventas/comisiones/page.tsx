import Link from "next/link";
import { DateTime } from "luxon";
import { ComisionesTabla } from "@/components/ventas/comisiones-tabla";
import { Card, FilterChip, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import type { ComFactura, ComVendedor } from "@/lib/comisiones";
import { getBusinessSettings } from "@/lib/quotes/server";
import { PERIODS, periodRange, type Period } from "@/lib/stats/sales-summary";
import { createClient } from "@/lib/supabase/server";

type Ver = "pagadas" | "por_cobrar";

/** Comisiones por vendedor y por factura (jefa de ventas). */
export default async function Comisiones({ searchParams }: { searchParams: Promise<{ p?: string; ver?: string }> }) {
  await requireRoles(["jefe_ventas", "ceo", "gerente"]);
  const sp = await searchParams;
  const periodo = (PERIODS.some((x) => x.id === sp.p) ? sp.p : "mes") as Period;
  const ver: Ver = sp.ver === "por_cobrar" ? "por_cobrar" : "pagadas";
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { from, to } = periodRange(periodo, DateTime.now().setZone(cfg.timezone));
  const d0 = from.toISODate()!;
  const d1 = to.toISODate()!;

  let q = supabase
    .from("ventas")
    .select("id, vendedor_id, factura, fecha, fecha_cobro, monto, moneda, porcentaje_cobrado, customers(nombre), venta_lineas(id, descripcion, cantidad, importe, comision_pct, comision, articulos(clave))")
    .eq("tipo", "venta")
    .is("cancelada_at", null)
    .order("fecha", { ascending: false })
    .limit(5000);
  q = ver === "pagadas" ? q.gte("porcentaje_cobrado", 100).gte("fecha_cobro", d0).lte("fecha_cobro", d1) : q.lt("porcentaje_cobrado", 100);
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
  const qs = (x: Record<string, string>) => `/ventas/comisiones?${new URLSearchParams({ p: periodo, ver, ...x }).toString()}`;

  return (
    <div className="space-y-5">
      <Link href="/ventas" className="text-sm text-slate-500 hover:text-slate-800">← Resumen de ventas</Link>
      <PageHeader title="Comisiones" subtitle="Comisión por artículo de cada factura: importe sin IVA × %. Pesos y dólares por separado." />
      {error && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">{/comision/.test(error.message) ? "Falta correr la actualización 0072 en la base." : error.message}</Card>}
      <div className="flex flex-wrap gap-2">
        <FilterChip href={qs({ ver: "pagadas" })} active={ver === "pagadas"}>Pagadas</FilterChip>
        <FilterChip href={qs({ ver: "por_cobrar" })} active={ver === "por_cobrar"}>Por cobrar (todavía no pagadas)</FilterChip>
        {ver === "pagadas" && (
          <span className="ml-auto flex flex-wrap gap-2">
            {PERIODS.map((p) => <FilterChip key={p.id} href={qs({ p: p.id })} active={periodo === p.id}>{p.label}</FilterChip>)}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">{ver === "pagadas" ? "Ventas cobradas al 100% en el periodo (por fecha de cobro)." : "Ventas registradas que todavía no se cobran al 100%: su comisión puede cambiar."}</p>
      <ComisionesTabla vendedores={vendedores} />
    </div>
  );
}
