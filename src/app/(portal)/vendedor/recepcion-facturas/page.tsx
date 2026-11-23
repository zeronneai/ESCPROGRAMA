import Link from "next/link";
import { EntregarFacturas, type FacturaDisponible } from "@/components/recepcion/entregar";
import { EntregasHistorial } from "@/components/recepcion/historial";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { cargarEntregas } from "@/lib/recepcion";
import { createClient } from "@/lib/supabase/server";
import { conTipoCambio } from "@/lib/ventas-server";
import { money } from "@/lib/ventas";

/** Recepcion de facturas (vendedor): entrega a finanzas las facturas fisicas ya cobradas. */
export default async function RecepcionFacturasVendedor() {
  const u = await requireRoles(["vendedor", "jefe_ventas"]);
  const supabase = await createClient();
  const [{ data: ventas }, hist, { data: recs, error: eRec }] = await Promise.all([
    supabase
      .from("ventas")
      .select("id, factura, fecha, fecha_cobro, monto, moneda, customers(nombre)")
      .eq("vendedor_id", u.id)
      .eq("tipo", "venta")
      .is("cancelada_at", null)
      .gte("porcentaje_cobrado", 100)
      .not("factura", "is", null)
      .order("fecha", { ascending: false })
      .limit(2000),
    cargarEntregas(supabase, u.id),
    supabase.from("factura_recepcion").select("venta_id, estado").eq("vendedor_id", u.id).limit(5000),
  ]);
  const vivas = new Set((recs ?? []).filter((r) => r.estado !== "rechazada").map((r) => r.venta_id as string));
  const rechazadas = new Set((recs ?? []).filter((r) => r.estado === "rechazada").map((r) => r.venta_id as string));
  type V = { id: string; factura: string; fecha: string; fecha_cobro: string | null; monto: string | null; moneda: string; customers: { nombre: string } | null };
  const disponibles: FacturaDisponible[] = (await conTipoCambio(supabase, ((ventas ?? []) as unknown as V[]).filter((v) => !vivas.has(v.id))))
    .map((v) => ({ tc: v.tipo_cambio, id: v.id, factura: v.factura, cliente: v.customers?.nombre ?? "Cliente", fecha: v.fecha.slice(0, 10), fecha_cobro: v.fecha_cobro, monto: Number(v.monto ?? 0), moneda: v.moneda, rechazada: rechazadas.has(v.id) }));
  const enRevision = (recs ?? []).filter((r) => r.estado === "por_revisar").length;
  const recibidas = (recs ?? []).filter((r) => r.estado === "recibida").length;
  const sinTabla = !!eRec || !!hist.error;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recepción de facturas"
        subtitle="Entrega a finanzas las facturas físicas que ya te pagaron. Elige cuáles traes y con qué pago se cobró cada una."
      />
      {sinTabla && <Card className="border-amber-200 bg-amber-50 text-sm text-amber-900">Falta correr la actualización 0070 en la base para usar este apartado.</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Cobradas sin entregar" value={disponibles.length} hint={money(disponibles.reduce((a, d) => a + d.monto * (d.moneda === "USD" ? d.tc ?? 0 : 1), 0))} />
        <StatCard label="En revisión" value={enRevision} tone={enRevision ? "amber" : "default"} />
        <StatCard label="Recibidas" value={recibidas} tone={recibidas ? "green" : "default"} />
        <StatCard label="Rechazadas" value={disponibles.filter((d) => d.rechazada).length} tone={disponibles.some((d) => d.rechazada) ? "red" : "default"} hint="Vuélvelas a entregar" />
      </div>
      <p className="text-xs text-slate-500">
        Aquí solo salen las facturas cobradas al 100%. Si una no aparece, márcala como cobrada en{" "}
        <Link href="/vendedor/bitacora?ver=por_cobrar" className="text-brand-700 underline">Ventas diarias</Link>.
      </p>
      {!sinTabla && <EntregarFacturas facturas={disponibles} />}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Mis entregas a finanzas</h2>
        <EntregasHistorial entregas={hist.entregas} modo="vendedor" />
      </section>
    </div>
  );
}
