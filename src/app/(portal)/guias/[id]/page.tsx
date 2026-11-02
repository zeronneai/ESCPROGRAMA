import Link from "next/link";
import { notFound } from "next/navigation";
import { GuiaPanel } from "@/components/guias/guia-panel";
import { Chip, Dl } from "@/components/ops-ui";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { elapsedText, GUIA_ESTADOS, guiaAlert, guiaTitle, hoursPending, SERVICIOS, type GuiaEstado, type Servicio } from "@/lib/ops/guias";
import { fmtDate, signedUrl } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

const EV: Record<string, string> = {
  alta: "Guía solicitada", en_proceso: "Marketplaces la está generando", requiere_datos: "Marketplaces pidió datos", reenviada: "El vendedor corrigió los datos",
  lista: "Guía lista para descargar", cancelada: "Guía cancelada", recordatorio: "El vendedor envió un recordatorio",
};
const STEPS = ["Solicitada", "Generando", "Lista"];

export default async function Guia({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: g }, { data: ev }, cfg] = await Promise.all([
    supabase.from("guias").select("*").eq("id", id).maybeSingle(),
    supabase.from("guia_eventos").select("id, tipo, nota, autor_nombre, created_at").eq("guia_id", id).order("created_at", { ascending: false }),
    getBusinessSettings(supabase),
  ]);
  if (!g) notFound();
  const tz = cfg.timezone;
  const estado = g.estado as GuiaEstado;
  const st = GUIA_ESTADOS[estado];
  const now = new Date();
  const alert = guiaAlert(g, now);
  const h = hoursPending(g, now);
  const url = await signedUrl(supabase, "guias", g.archivo_path, g.archivo_nombre);
  const n = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
  const form = {
    factura: g.factura, destinatario: g.destinatario, paqueteria: g.paqueteria, paqueteria_otra: g.paqueteria_otra ?? "", servicio: g.servicio,
    customer_id: g.customer_id, contacto_nombre: g.contacto_nombre ?? "", telefono: g.telefono, correo: g.correo ?? "", calle_numero: g.calle_numero,
    colonia: g.colonia ?? "", cp: g.cp, ciudad: g.ciudad, estado_geo: g.estado_geo, referencias: g.referencias ?? "", bultos: String(g.bultos),
    peso_kg: n(g.peso_kg), largo_cm: n(g.largo_cm), ancho_cm: n(g.ancho_cm), alto_cm: n(g.alto_cm), contenido: g.contenido ?? "",
    valor_declarado: n(g.valor_declarado), asegurar: g.asegurar, urgente: g.urgente, notas: g.notas ?? "",
  };
  const medidas = [g.largo_cm, g.ancho_cm, g.alto_cm].every(Boolean) ? `${n(g.largo_cm)} × ${n(g.ancho_cm)} × ${n(g.alto_cm)} cm` : "";

  return (
    <div className="space-y-4">
      <Link href="/guias" className="text-sm text-slate-500 hover:text-slate-800">← Guías</Link>
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          {guiaTitle(g)} {g.urgente && <Chip cls="bg-red-600 text-white">URGENTE</Chip>} <Chip cls={st.chip}>{st.label}</Chip>
        </h1>
        <p className="text-sm text-slate-500">{g.numero} · Pide {g.vendedor_nombre} · {fmtDate(g.created_at, tz)}{g.atendida_nombre && ` · Atiende ${g.atendida_nombre}`}</p>
      </div>

      {estado !== "cancelada" && (
        <ol className="grid grid-cols-3 gap-1 text-center text-xs font-medium">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded-md px-2 py-2 ${i <= st.step ? (i === 2 ? "bg-green-600 text-white" : "bg-brand-600 text-white") : "bg-slate-100 text-slate-500"}`}>{s}</li>
          ))}
        </ol>
      )}
      {alert && h !== null && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${alert === "roja" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          {alert === "roja" ? <strong>Lleva {elapsedText(h)} sin resolverse. </strong> : <>Lleva {elapsedText(h)} pendiente. </>}
          {g.recordatorios > 0 && `Recordatorios enviados: ${g.recordatorios}.`}
        </div>
      )}

      <GuiaPanel
        g={{ id: g.id, estado, solicitada_at: g.solicitada_at, ultimo_recordatorio_at: g.ultimo_recordatorio_at, mensaje: g.mensaje, archivo_url: url, archivo_nombre: g.archivo_nombre, numero_rastreo: g.numero_rastreo, atendida_nombre: g.atendida_nombre, form }}
        role={u.rol}
        isOwner={u.id === g.vendedor_id}
        events={(ev ?? []).map((e) => ({ id: e.id, texto: e.tipo === "comentario" ? e.nota : `${EV[e.tipo] ?? e.tipo}${e.nota ? `: ${e.nota}` : ""}`, autor: e.autor_nombre, fecha: e.created_at, comentario: e.tipo === "comentario" }))}
      />

      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Datos del envío</h2>
        <Dl
          items={[
            ["Factura", g.factura],
            ["Paquetería", `${g.paqueteria === "Otra" ? g.paqueteria_otra : g.paqueteria} · ${SERVICIOS[g.servicio as Servicio]}`],
            ["Persona o negocio", g.destinatario],
            ["Recibe", g.contacto_nombre],
            ["Teléfono", g.telefono],
            ["Correo", g.correo],
            ["Dirección", [g.calle_numero, g.colonia && `Col. ${g.colonia}`, `CP ${g.cp}`, `${g.ciudad}, ${g.estado_geo}`].filter(Boolean).join(", ")],
            ["Referencias", g.referencias],
            ["Bultos y peso", `${g.bultos} bulto(s) · ${n(g.peso_kg)} kg`],
            ["Medidas", medidas],
            ["Contenido", g.contenido],
            ["Valor declarado", g.valor_declarado !== null ? `$${Number(g.valor_declarado).toLocaleString("es-MX")} MXN` : ""],
            ["Seguro", g.asegurar ? "Sí, asegurar" : ""],
            ["Notas", g.notas],
          ]}
        />
      </Card>
    </div>
  );
}
