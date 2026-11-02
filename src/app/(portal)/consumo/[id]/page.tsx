import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsumoPanel } from "@/components/consumo/consumo-panel";
import { Chip, Dl } from "@/components/ops-ui";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { avanceLabel, CATEGORIAS, CONSUMO_ESTADOS, type Categoria, type ConsumoEstado } from "@/lib/ops/consumo";
import { fmtDate, fmtDay } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const FLOW: ConsumoEstado[] = ["por_aprobar", "aprobada", "en_proceso", "completada"];

export default async function ConsumoDetalle({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: c }, { data: ev }, cfg] = await Promise.all([
    supabase.from("consumo_solicitudes").select("*").eq("id", id).maybeSingle(),
    supabase.from("consumo_eventos").select("id, tipo, nota, autor_nombre, created_at").eq("solicitud_id", id).order("created_at", { ascending: false }),
    getBusinessSettings(supabase),
  ]);
  if (!c) notFound();
  const estado = c.estado as ConsumoEstado;
  const tipo = c.tipo as "producto" | "servicio";
  const label: Record<string, string> = {
    alta: "Solicitud creada", aprobada: "Aprobada", rechazada: "Rechazada", cancelada: "Cancelada",
    en_proceso: avanceLabel(tipo, "en_proceso"), completada: avanceLabel(tipo, "completada"),
  };
  const steps = ["Por aprobar", "Aprobada", avanceLabel(tipo, "en_proceso"), avanceLabel(tipo, "completada")];
  const at = FLOW.indexOf(estado);
  return (
    <div className="space-y-4">
      <Link href="/consumo" className="text-sm text-slate-500 hover:text-slate-800">← Consumo interno</Link>
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          {c.descripcion} {c.urgente && <Chip cls="bg-red-600 text-white">URGENTE</Chip>} <Chip cls={CONSUMO_ESTADOS[estado].chip}>{CONSUMO_ESTADOS[estado].label}</Chip>
        </h1>
        <p className="text-sm text-slate-500">{c.numero} · {c.solicitante_nombre} · {fmtDate(c.created_at, cfg.timezone)}</p>
      </div>
      {at >= 0 && (
        <ol className="grid grid-cols-4 gap-1 text-center text-[11px] font-medium sm:text-xs">
          {steps.map((s, i) => (
            <li key={s} className={`rounded-md px-1 py-2 ${i <= at ? (i === 3 ? "bg-green-600 text-white" : "bg-brand-600 text-white") : "bg-slate-100 text-slate-500"}`}>{s}</li>
          ))}
        </ol>
      )}
      {estado === "rechazada" && <Card className="border-red-200 bg-red-50 text-sm text-red-900"><strong>Rechazada por {c.aprobada_nombre}:</strong> {c.rechazo_motivo}</Card>}
      <Card className="p-4">
        <Dl
          items={[
            ["Tipo", tipo === "servicio" ? "Servicio" : "Producto o material"],
            ["Categoría", CATEGORIAS[c.categoria as Categoria]],
            ["Cantidad", `${Number(c.cantidad).toLocaleString("es-MX")} ${c.unidad ?? ""}`],
            ["Para qué se necesita", c.motivo],
            ["Aprobó", c.aprobada_at && estado !== "rechazada" ? `${c.aprobada_nombre} · ${fmtDate(c.aprobada_at, cfg.timezone)}` : ""],
            [tipo === "servicio" ? "Fecha agendada" : "Fecha estimada", fmtDay(c.fecha_programada)],
            ["Nota de compras", c.compra_nota],
            ["Completada", fmtDate(c.completada_at, cfg.timezone)],
          ]}
        />
      </Card>
      <ConsumoPanel
        c={{ id: c.id, estado, tipo, fecha_programada: c.fecha_programada }}
        role={u.rol}
        isOwner={c.solicitante_id === u.id}
        form={{ tipo: c.tipo, categoria: c.categoria, descripcion: c.descripcion, cantidad: String(Number(c.cantidad)), unidad: c.unidad ?? "", motivo: c.motivo, urgente: c.urgente }}
        events={(ev ?? []).map((e) => ({ id: e.id, texto: e.tipo === "comentario" ? e.nota : `${label[e.tipo] ?? e.tipo}${e.nota ? `: ${e.nota}` : ""}`, autor: e.autor_nombre, fecha: e.created_at, comentario: e.tipo === "comentario" }))}
      />
    </div>
  );
}
