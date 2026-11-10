import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { OcAcciones } from "@/components/pagos/oc-header";
import { OcPagos } from "@/components/pagos/oc-pagos";
import { ProformaPanel } from "@/components/pagos/proforma-panel";
import type { ProvOpcion } from "@/components/pagos/oc-form";
import { Chip } from "@/components/ops-ui";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { fmtMonto, OC_COLS, ordenarProvs, PAGO_COLS, type OcRow, type PagoRow } from "@/lib/pagos";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function OcDetalle({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(["comprador", "ceo"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const today = DateTime.now().setZone(cfg.timezone).toISODate()!;
  const [{ data: o }, { data: ps }] = await Promise.all([
    supabase.from("ordenes_compra").select(OC_COLS).eq("id", id).maybeSingle(),
    supabase.from("pagos").select(PAGO_COLS).eq("oc_id", id).order("created_at"),
  ]);
  if (!o) notFound();
  const oc = o as unknown as OcRow;
  const pagos = (ps ?? []) as PagoRow[];
  const comprador = u.rol === "comprador";
  const provs = comprador ? ordenarProvs(((await supabase.from("suppliers").select("id, nombre, pagos_moneda, en_pagos, tipo").eq("activo", true).order("nombre")).data ?? []) as ProvOpcion[]) : [];
  const sum = (l: (number | string | null)[]) => l.reduce<number>((a, n) => a + Number(n ?? 0), 0);
  const hechos = pagos.filter((p) => p.estado === "pagado" || p.estado === "cerrado");
  const facturas = pagos.filter((p) => p.tipo === "factura");
  const facturado = sum(facturas.map((p) => p.monto));
  const pagado = sum(hechos.map((p) => p.pago_monto ?? p.monto));
  const anticipoPagado = sum(hechos.filter((p) => p.tipo === "anticipo").map((p) => p.pago_monto ?? p.monto));
  const anticipoLibre = Math.max(0, Math.round((anticipoPagado - sum(facturas.map((p) => p.anticipo_aplicado ?? 0))) * 100) / 100);
  const anticiposPend = sum(pagos.filter((p) => p.tipo === "anticipo" && p.estado === "pendiente").map((p) => p.monto));
  const total = oc.monto != null ? Number(oc.monto) : oc.proforma_monto != null ? Number(oc.proforma_monto) : null;
  // Lo que se debe: el total de la OC o lo facturado (lo que sea mayor), o lo registrado si aun no hay total.
  const base = Math.max(total ?? 0, facturado, total == null ? facturado + anticipoPagado + anticiposPend : 0);
  const porFacturar = total != null ? Math.max(0, total - facturado) : 0;

  return (
    <div className="space-y-4">
      <Link href="/pagos" className="text-sm text-slate-500 hover:text-slate-800">← Pagos</Link>
      <PageHeader
        title={`OC ${oc.numero}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {oc.suppliers?.nombre}{oc.suppliers?.pais ? ` (${oc.suppliers.pais})` : ""} · {new Date(`${oc.fecha}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })} · {oc.moneda}
            {oc.cerrada_at && <Chip cls="bg-slate-200 text-slate-700">OC cerrada</Chip>}
          </span>
        }
      />
      {oc.descripcion && <p className="text-sm text-slate-700">{oc.descripcion}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total de la OC" value={total != null ? fmtMonto(total, oc.moneda) : "Sin monto"} hint={oc.monto == null && oc.proforma_monto != null ? "Según la proforma" : undefined} />
        <StatCard label="Facturado" value={fmtMonto(facturado, oc.moneda)} hint={porFacturar > 0.004 ? `Falta por facturar ${fmtMonto(porFacturar, oc.moneda)}` : `${facturas.length} factura(s)`} />
        <StatCard label="Pagado" value={fmtMonto(pagado, oc.moneda)} tone={pagado > 0 ? "green" : "default"} hint={anticipoLibre > 0.004 ? `Anticipo por descontar ${fmtMonto(anticipoLibre, oc.moneda)}` : undefined} />
        <StatCard label="Falta por pagar" value={fmtMonto(Math.max(0, base - pagado), oc.moneda)} tone={base - pagado > 0 ? "amber" : "green"} />
      </div>
      {comprador && <Card className="p-3"><OcAcciones oc={oc} proveedores={provs} today={today} sinPagos={pagos.length === 0} /></Card>}
      <ProformaPanel oc={oc} comprador={comprador} />
      <OcPagos ocId={oc.id} moneda={oc.moneda} pagos={pagos} anticipoLibre={anticipoLibre} rol={comprador ? "comprador" : "ceo"} today={today} cerrada={!!oc.cerrada_at} />
    </div>
  );
}
