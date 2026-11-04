import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { OcAcciones } from "@/components/pagos/oc-header";
import { OcPagos } from "@/components/pagos/oc-pagos";
import type { ProvOpcion } from "@/components/pagos/oc-form";
import { Chip } from "@/components/ops-ui";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { fmtMonto, OC_COLS, PAGO_COLS, type OcRow, type PagoRow } from "@/lib/pagos";
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
  const provs = comprador ? (((await supabase.from("suppliers").select("id, nombre, pagos_moneda").eq("en_pagos", true).order("nombre")).data ?? []) as ProvOpcion[]) : [];
  const sum = (l: (number | string | null)[]) => l.reduce<number>((a, n) => a + Number(n ?? 0), 0);
  const facturado = sum(pagos.map((p) => p.monto));
  const pagado = sum(pagos.filter((p) => p.estado === "pagado" || p.estado === "cerrado").map((p) => p.pago_monto ?? p.monto));
  const base = oc.monto != null ? Number(oc.monto) : facturado;

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
        <StatCard label="Monto de la OC" value={oc.monto != null ? fmtMonto(oc.monto, oc.moneda) : "Sin monto"} />
        <StatCard label="Facturas y anticipos" value={fmtMonto(facturado, oc.moneda)} hint={`${pagos.length} registro(s)`} />
        <StatCard label="Pagado" value={fmtMonto(pagado, oc.moneda)} tone={pagado > 0 ? "green" : "default"} />
        <StatCard label="Falta por pagar" value={fmtMonto(Math.max(0, base - pagado), oc.moneda)} tone={base - pagado > 0 ? "amber" : "green"} />
      </div>
      {comprador && <Card className="p-3"><OcAcciones oc={oc} proveedores={provs} today={today} sinPagos={pagos.length === 0} /></Card>}
      <OcPagos ocId={oc.id} moneda={oc.moneda} pagos={pagos} rol={comprador ? "comprador" : "ceo"} today={today} cerrada={!!oc.cerrada_at} />
    </div>
  );
}
