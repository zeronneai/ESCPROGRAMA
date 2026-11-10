import Link from "next/link";
import { DateTime } from "luxon";
import { AnalisisEditor } from "@/components/riesgos/editor";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { ROL_LABEL } from "@/lib/ops/roles";
import { getBusinessSettings } from "@/lib/quotes/server";
import { RIESGO_ROLES } from "@/lib/riesgos";
import { createClient } from "@/lib/supabase/server";

const PROCESO: Partial<Record<string, string>> = {
  jefe_ventas: "Ventas", supervisor_finanzas: "Administración y finanzas", gerente: "Dirección", ceo: "Dirección",
  comprador: "Compras", almacen: "Almacén", supervisor_almacen: "Almacén", coordinador_iso: "",
};

export default async function NuevoAnalisis() {
  const u = await requireRoles(RIESGO_ROLES);
  const cfg = await getBusinessSettings(await createClient());
  const today = DateTime.now().setZone(cfg.timezone).toISODate()!;
  return (
    <div className="space-y-4">
      <Link href="/calidad/riesgos" className="text-sm text-slate-500 hover:text-slate-800">← Análisis de riesgo</Link>
      <PageHeader title="Nuevo análisis de riesgo" subtitle={`${ROL_LABEL[u.rol]}: escribe tus actividades y, en cada una, todo lo que puede fallar. Se llena por etapas.`} />
      <AnalisisEditor id={null} inicial={{ proceso: PROCESO[u.rol] ?? "", fecha: today, actividades: [] }} puedeEditar today={today} />
    </div>
  );
}
