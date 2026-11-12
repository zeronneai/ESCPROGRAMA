import Link from "next/link";
import { notFound } from "next/navigation";
import { GuiaPanel } from "@/components/guias/guia-panel";
import { GuiaDatosView } from "@/components/guias/guia-datos";
import { Chip } from "@/components/ops-ui";
import { requireUser } from "@/lib/auth/guards";
import { elapsedText, empaqueLabel, GUIA_ESTADOS, guiaAlert, guiaTitle, hoursPending, partidasDeGuia, resumenPartidas, SERVICIOS, type GuiaEstado, type Servicio } from "@/lib/ops/guias";
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
  // El vendedor solo ve el numero de guia; el archivo lo descargan Marketplaces y los jefes.
  const url = u.rol === "vendedor" ? null : await signedUrl(supabase, "guias", g.archivo_path, g.archivo_nombre);
  const n = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
  const form = {
    factura: g.factura, destinatario: g.destinatario, paqueteria: g.paqueteria, paqueteria_otra: g.paqueteria_otra ?? "", servicio: g.servicio,
    customer_id: g.customer_id, contacto_nombre: g.contacto_nombre ?? "", telefono: g.telefono, correo: g.correo ?? "", calle_numero: g.calle_numero,
    colonia: g.colonia ?? "", cp: g.cp, ciudad: g.ciudad, estado_geo: g.estado_geo, referencias: g.referencias ?? "", contenido: g.contenido ?? "",
    valor_declarado: n(g.valor_declarado), valor_moneda: g.valor_moneda === "USD" ? "USD" : "MXN", asegurar: g.asegurar, urgente: g.urgente, notas: g.notas ?? "",
  };
  const partidas = partidasDeGuia(g);
  const conPartidas = Array.isArray(g.partidas);
  const s0 = (x: number | null) => (x == null ? "" : String(x));
  const partidasForm = partidas.map((p, i) => ({
    key: `p${i}`, empaque: p.empaque, cantidad: String(p.cantidad), peso_kg: String(p.peso_kg),
    largo_cm: s0(p.largo_cm), ancho_cm: s0(p.ancho_cm), alto_cm: s0(p.alto_cm), descripcion: p.descripcion ?? "",
  }));
  const mkt = u.rol === "marketplaces";
  const medidas = [g.largo_cm, g.ancho_cm, g.alto_cm].every(Boolean) ? `${n(g.largo_cm)} × ${n(g.ancho_cm)} × ${n(g.alto_cm)} cm` : "";
  const datos = (
    <GuiaDatosView
      palomear={mkt && (estado === "solicitada" || estado === "en_proceso" || estado === "requiere_datos")}
      d={{
        id: g.id, listas: Array.isArray(g.partidas_listas) ? (g.partidas_listas as number[]) : [],
        factura: g.factura, paqueteria: g.paqueteria === "Otra" ? g.paqueteria_otra ?? "Otra" : g.paqueteria, servicio: SERVICIOS[g.servicio as Servicio] ?? g.servicio,
        urgente: g.urgente, asegurar: g.asegurar, destinatario: g.destinatario, contacto_nombre: g.contacto_nombre, telefono: g.telefono, correo: g.correo,
        calle_numero: g.calle_numero, colonia: g.colonia, cp: g.cp, ciudad: g.ciudad, estado_geo: g.estado_geo, referencias: g.referencias,
        partidas, conPartidas, resumenViejo: empaqueLabel(g.empaque, g.bultos), medidasViejas: medidas, peso_total: n(g.peso_kg),
        contenido: g.contenido, notas: g.notas,
        valor: g.valor_declarado !== null ? `$${Number(g.valor_declarado).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${g.valor_moneda === "USD" ? "USD" : "MXN"}` : null,
      }}
    />
  );

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
        <div className={`rounded-lg border px-4 py-3 text-sm ${alert === "roja" ? "animate-pulse border-2 border-red-700 bg-red-600 text-white shadow-lg" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          {alert === "roja" ? <strong className="text-base">ATRASADA: lleva {elapsedText(h)} sin resolverse (límite 2 horas). </strong> : <>Lleva {elapsedText(h)} pendiente. A las 2 horas se pone en rojo. </>}
          {g.recordatorios > 0 && `Recordatorios enviados: ${g.recordatorios}.`}
        </div>
      )}

      {mkt && datos}

      <GuiaPanel
        g={{ id: g.id, estado, solicitada_at: g.solicitada_at, ultimo_recordatorio_at: g.ultimo_recordatorio_at, mensaje: g.mensaje, archivo_url: url, archivo_nombre: g.archivo_nombre, numero_rastreo: g.numero_rastreo, atendida_nombre: g.atendida_nombre, form, partidas: partidasForm }}
        role={u.rol}
        isOwner={u.id === g.vendedor_id}
        events={(ev ?? []).map((e) => ({ id: e.id, texto: e.tipo === "comentario" ? e.nota : `${EV[e.tipo] ?? e.tipo}${e.nota ? `: ${e.nota}` : ""}`, autor: e.autor_nombre, fecha: e.created_at, comentario: e.tipo === "comentario" }))}
      />

      {!mkt && datos}
    </div>
  );
}
