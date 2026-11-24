import Link from "next/link";
import { notFound } from "next/navigation";
import { ListaConciliacion } from "@/components/finanzas/lista-conciliacion";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { cargarMovimientos } from "@/lib/conciliaciones";
import { createClient } from "@/lib/supabase/server";
import { money2 } from "@/lib/ventas";

/** Un estado de cuenta subido: sus abonos y quien identifico cada uno. */
export default async function ConciliacionDetalle({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(["aux_finanzas", "supervisor_finanzas", "jefe_ventas"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("conciliaciones").select("id, banco, cuenta, moneda, desde, hasta, archivo_path, nombre_archivo").eq("id", id).maybeSingle();
  if (!c) notFound();
  const { movs, error } = await cargarMovimientos(supabase, { conciliacionId: id });
  const libres = movs.filter((m) => !m.tomado_por);
  return (
    <div className="space-y-4">
      <Link href="/finanzas/conciliaciones" className="text-sm text-slate-500 hover:text-slate-800">← Conciliaciones</Link>
      <PageHeader title={`${c.banco} ···${String(c.cuenta ?? "").slice(-4)}${c.moneda === "USD" ? " (dólares)" : ""}`} subtitle={c.nombre_archivo ?? undefined} />
      {c.archivo_path && <a href={`/api/conciliaciones/${c.id}`} target="_blank" rel="noreferrer" className="text-sm text-brand-700 underline">Ver PDF del estado de cuenta</a>}
      {error && <Card className="text-sm text-red-700">{error}</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Abonos" value={movs.length} />
        <StatCard label="Identificados" value={movs.length - libres.length} tone="green" />
        <StatCard label="Sin identificar" value={libres.length} tone={libres.length ? "amber" : "default"} />
        <StatCard label="Monto sin identificar" value={money2(libres.reduce((a, m) => a + m.monto, 0), c.moneda as string)} />
      </div>
      <ListaConciliacion movs={movs} modo="finanzas" uid={u.id} />
    </div>
  );
}
