import Link from "next/link";
import { DateTime } from "luxon";
import { SacForm } from "@/components/calidad/sac-form";
import { emptySac } from "@/lib/ops/sac-values";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { INCIDENCIA_CODIGO, INCIDENCIA_TIPOS, INCIDENCIA_VARIANTES, type AlertaIncidencia, type Incidencia } from "@/lib/incidencias";

export default async function NuevaSac({ searchParams }: { searchParams: Promise<{ queja?: string; alerta?: string }> }) {
  const u = await requireRoles(["coordinador_iso"]);
  const { queja, alerta } = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const { data: quejas } = await supabase.from("quejas").select("id, numero, cliente_nombre, descripcion").not("estado", "in", "(cerrada,por_revisar,no_aplica)").order("created_at", { ascending: false }).limit(200);
  const q = (quejas ?? []).find((x) => x.id === queja) ?? null;
  // Desde la bitacora de incidencias: 3 de la misma en el mes.
  const al = alerta && /^[0-9a-f-]{36}$/i.test(alerta) ? (await supabase.from("incidencias_alertas").select("id, tipo, mes, n, sac_id").eq("id", alerta).maybeSingle()).data as AlertaIncidencia | null : null;
  let ini = emptySac(DateTime.now().setZone(cfg.timezone).toISODate()!, u.nombre, q?.id ?? null, q?.descripcion ?? "");
  if (al && !al.sac_id) {
    const finMes = DateTime.fromISO(al.mes).plus({ months: 1 }).toISODate()!;
    const { data: incs } = await supabase.from("incidencias").select("folio, fecha, variante, producto, cliente, factura, accion").eq("tipo", al.tipo).is("cancelada_at", null).gte("fecha", al.mes).lt("fecha", finMes).order("fecha");
    const det = ((incs ?? []) as Pick<Incidencia, "folio" | "fecha" | "variante" | "producto" | "cliente" | "factura" | "accion">[])
      .map((i) => `- ${i.folio} (${i.fecha})${i.variante ? ` ${INCIDENCIA_VARIANTES[i.variante]}` : ""}: ${[i.producto, i.cliente, i.factura ? `factura ${i.factura}` : null].filter(Boolean).join(" · ")}${i.accion ? `. Acción: ${i.accion}` : ""}`)
      .join("\n");
    ini = {
      ...ini,
      fuente: al.tipo === "producto_no_conforme" ? "producto_no_conforme" : "otro",
      fuente_otro: al.tipo === "producto_no_conforme" ? "" : `Bitácora de incidencias (${INCIDENCIA_CODIGO})`,
      descripcion: `Se registraron ${al.n} incidencias de "${INCIDENCIA_TIPOS[al.tipo].label}" en ${DateTime.fromISO(al.mes).setLocale("es").toFormat("LLLL yyyy")} (bitácora ${INCIDENCIA_CODIGO}):\n${det}`.slice(0, 4000),
    };
  }
  return (
    <div className="space-y-4">
      <Link href={q ? `/calidad/quejas/${q.id}` : alerta ? "/incidencias" : "/calidad?tab=sac"} className="text-sm text-slate-500 hover:text-slate-800">← {q ? `Queja ${q.numero}` : alerta ? "Bitácora de incidencias" : "Acciones correctivas"}</Link>
      <PageHeader title="Solicitud de acción correctiva" subtitle="Formato ESC-SGC-FR-001. Puedes guardarla y seguir llenándola después." />
      <Card className="p-4 sm:p-6">
        <SacForm id={null} readOnly={false} quejas={quejas ?? []} initial={ini} alertaId={al && !al.sac_id ? al.id : null} />
      </Card>
    </div>
  );
}
