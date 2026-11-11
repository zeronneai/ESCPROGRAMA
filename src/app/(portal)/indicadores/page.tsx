import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import type { Rol } from "@/lib/auth/route-guard";
import { satisfaccion } from "@/lib/evaluaciones";
import { ROL_LABEL } from "@/lib/ops/roles";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { cobroEstado, money, saldo, type VentaRow } from "@/lib/ventas";

type Tone = "green" | "amber" | "red" | "default";
interface Ind {
  titulo: string;
  valor: string;
  detalle?: string;
  tono?: Tone;
}
interface Grupo {
  titulo: string;
  items: Ind[];
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const fmtPct = (n: number | null) => (n === null ? "-" : `${n}%`);
const delta = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% vs mes anterior` : "Sin datos del mes anterior");
const toneBy = (n: number | null, good: number, ok: number): Tone => (n === null ? "default" : n >= good ? "green" : n >= ok ? "amber" : "red");

export default async function Indicadores() {
  const u = await requireUser();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const now = DateTime.now().setZone(cfg.timezone);
  const m0 = now.startOf("month");
  const m1 = m0.minus({ months: 1 });
  const ctx = { u, supabase, cfg, now, today: now.toISODate()!, m0, m1 };
  const grupos: Grupo[] = [];
  const rol = u.rol as Rol;

  if (rol === "vendedor") grupos.push(...(await ventasGrupos(ctx, u.id)));
  if (rol === "jefe_ventas" || (rol === "gerente" || rol === "ceo")) grupos.push(...(await ventasGrupos(ctx, null)));
  if (rol === "comprador" || (rol === "gerente" || rol === "ceo")) grupos.push(await comprasGrupo(ctx));
  if (rol === "comprador" || rol === "almacen" || rol === "supervisor_almacen" || (rol === "gerente" || rol === "ceo") || rol === "coordinador_iso") grupos.push(await proveedoresGrupo(ctx, rol));
  if (rol === "coordinador_iso" || (rol === "gerente" || rol === "ceo")) grupos.push(await calidadGrupo(ctx));
  if (rol === "marketplaces" || (rol === "gerente" || rol === "ceo") || rol === "jefe_ventas") grupos.push(await guiasGrupo(ctx));
  if (rol === "coordinador_iso" || rol === "comprador") grupos.push(await clientesGrupo(ctx));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicadores"
        subtitle={`${ROL_LABEL[rol]} · ${m0.setLocale("es-MX").toFormat("LLLL yyyy")}. Salen solos de lo que se registra en el portal; cuando se definan los oficiales y sus metas, se ajustan.`}
      />
      {grupos.map((g) => (
        <section key={g.titulo} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g.titulo}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((i) => (
              <Card key={i.titulo} className={`space-y-1 border-l-4 p-4 ${i.tono === "green" ? "border-l-green-500" : i.tono === "amber" ? "border-l-amber-400" : i.tono === "red" ? "border-l-red-500" : "border-l-slate-200"}`}>
                <p className="text-xs font-medium text-slate-500">{i.titulo}</p>
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{i.valor}</p>
                {i.detalle && <p className="text-xs text-slate-500">{i.detalle}</p>}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type Ctx = { supabase: SupabaseClient; today: string; m0: DateTime; m1: DateTime; cfg: { slaHours: number } };

async function ventasGrupos(c: Ctx, sellerId: string | null): Promise<Grupo[]> {
  function scope<T>(q: T, k: string): T {
    return sellerId ? (q as unknown as { eq: (a: string, b: string) => T }).eq(k, sellerId) : q;
  }
  const [{ data: vs }, { data: iss }, { data: bit }, { count: conv }, { data: enc }] = await Promise.all([
    scope(c.supabase.from("ventas").select("vendedor_id, fecha, monto, moneda, pago, vence, porcentaje_cobrado, cancelada_at, request_id, created_at").eq("tipo", "venta").gte("fecha", c.m1.toISODate()!), "vendedor_id").limit(20000),
    scope(c.supabase.from("quote_issues").select("request_id, emitida_at").gte("emitida_at", c.m0.toUTC().toISO()!), "emitida_por").limit(10000),
    scope(c.supabase.from("bitacora").select("resultado, proximo_seguimiento, archived_at"), "vendedor_id").is("archived_at", null).limit(10000),
    scope(c.supabase.from("customers").select("id", { count: "exact", head: true }).gte("convertido_at", c.m0.toUTC().toISO()!), "convertido_por"),
    scope(c.supabase.from("encuestas_cliente").select("respuestas, escala, respondida_at, eval_periodos!inner(estado)").not("respondida_at", "is", null), "vendedor_id").limit(5000),
  ]);
  const { data: cart } = await scope(c.supabase.from("ventas").select("monto, moneda, pago, vence, porcentaje_cobrado, cancelada_at").eq("tipo", "venta").is("cancelada_at", null).lt("porcentaje_cobrado", 100), "vendedor_id").limit(20000);
  const ventas = (vs ?? []) as unknown as VentaRow[];
  const vivas = ventas.filter((v) => !v.cancelada_at);
  const mes = vivas.filter((v) => v.fecha >= c.m0.toISODate()!);
  const ant = vivas.filter((v) => v.fecha < c.m0.toISODate()!);
  const sum = (l: VentaRow[]) => l.filter((v) => v.moneda === "MXN").reduce((a, v) => a + Number(v.monto ?? 0), 0);
  const cot = new Set((iss ?? []).map((i) => i.request_id));
  const ganadas = new Set(mes.filter((v) => v.request_id && cot.has(v.request_id)).map((v) => v.request_id));
  const conversion = pct(ganadas.size, cot.size);
  const abiertos = (bit ?? []).filter((b) => b.resultado === "abierta");
  const alDia = abiertos.filter((b) => !b.proximo_seguimiento || b.proximo_seguimiento >= c.today).length;
  const seg = pct(alDia, abiertos.length);
  const pend = (cart ?? []) as unknown as VentaRow[];
  const totalPend = pend.reduce((a, v) => a + saldo(v), 0);
  const vencido = pend.filter((v) => cobroEstado(v, c.today) === "vencida").reduce((a, v) => a + saldo(v), 0);
  const pv = pct(Math.round(vencido), Math.round(totalPend));
  const sat = satisfaccion((enc ?? []) as { respuestas: Record<string, number>; escala: number }[]);
  return [
    {
      titulo: sellerId ? "Mis ventas" : "Ventas del equipo",
      items: [
        { titulo: "Monto vendido en el mes (MXN, sin IVA)", valor: money(sum(mes)), detalle: delta(sum(mes), sum(ant)), tono: sum(mes) >= sum(ant) ? "green" : "amber" },
        { titulo: "Ventas registradas en el mes", valor: String(mes.length), detalle: `${ant.length} el mes anterior` },
        { titulo: "Conversión de cotizaciones", valor: fmtPct(conversion), detalle: `${ganadas.size} de ${cot.size} cotizaciones enviadas este mes terminaron en venta`, tono: toneBy(conversion, 40, 20) },
        { titulo: "Cartera vencida", valor: money(vencido), detalle: pv !== null ? `${pv}% de lo que está por cobrar` : "Nada por cobrar", tono: vencido > 0 ? (pv !== null && pv > 20 ? "red" : "amber") : "green" },
      ],
    },
    {
      titulo: sellerId ? "Mi prospección y clientes" : "Prospección y clientes",
      items: [
        { titulo: "Prospectos que se volvieron clientes (mes)", valor: String(conv ?? 0), tono: (conv ?? 0) > 0 ? "green" : "default" },
        { titulo: "Prospectos con seguimiento al día", valor: fmtPct(seg), detalle: `${alDia} de ${abiertos.length} prospectos activos`, tono: toneBy(seg, 90, 70) },
        { titulo: "Satisfacción de clientes", valor: fmtPct(sat.pct), detalle: "Satisfecho o muy satisfecho, todas las evaluaciones respondidas", tono: toneBy(sat.pct, 85, 70) },
      ],
    },
  ];
}

async function comprasGrupo(c: Ctx): Promise<Grupo> {
  const { data } = await c.supabase.from("quote_items").select("estado, response_business_hours, first_response_at").gte("first_response_at", c.m0.toUTC().toISO()!).limit(20000);
  const r = (data ?? []).filter((i) => i.response_business_hours !== null);
  const avg = r.length ? r.reduce((a, i) => a + Number(i.response_business_hours), 0) / r.length : null;
  const enTiempo = pct(r.filter((i) => Number(i.response_business_hours) <= c.cfg.slaHours).length, r.length);
  const nf = pct((data ?? []).filter((i) => i.estado === "no_encontrada").length, (data ?? []).length);
  const { count: consumo } = await c.supabase.from("consumo_solicitudes").select("id", { count: "exact", head: true }).eq("estado", "aprobada");
  return {
    titulo: "Compras",
    items: [
      { titulo: "Tiempo promedio de respuesta", valor: avg !== null ? `${Math.round(avg * 10) / 10} h hábiles` : "-", detalle: "Partidas respondidas este mes", tono: avg === null ? "default" : avg <= c.cfg.slaHours ? "green" : "red" },
      { titulo: `Respondidas dentro de ${c.cfg.slaHours} h hábiles`, valor: fmtPct(enTiempo), detalle: `${r.length} partidas este mes`, tono: toneBy(enTiempo, 90, 75) },
      { titulo: "Partidas no encontradas", valor: fmtPct(nf), detalle: "Del total respondido este mes", tono: nf === null ? "default" : nf <= 10 ? "green" : nf <= 20 ? "amber" : "red" },
      { titulo: "Consumo interno por atender", valor: String(consumo ?? 0), tono: (consumo ?? 0) > 0 ? "amber" : "green" },
    ],
  };
}

async function proveedoresGrupo(c: Ctx, rol: Rol): Promise<Grupo> {
  const { data: per } = await c.supabase.from("eval_periodos").select("id, nombre, estado").eq("tipo", "proveedores").neq("estado", "programado").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data } = per ? await c.supabase.from("eval_proveedor").select("puntaje, comprador_at, almacen_at").eq("periodo_id", per.id) : { data: [] };
  const rows = data ?? [];
  const comp = rows.filter((r) => r.comprador_at && r.almacen_at);
  const prom = comp.length ? Math.round((comp.reduce((a, r) => a + Number(r.puntaje), 0) / comp.length) * 10) / 10 : null;
  const conf = pct(comp.filter((r) => Number(r.puntaje) >= 85).length, comp.length);
  const mine = rol === "almacen" || rol === "supervisor_almacen" ? rows.filter((r) => !r.almacen_at).length : rows.filter((r) => !r.comprador_at).length;
  return {
    titulo: `Evaluación de proveedores${per ? ` (${per.nombre}${per.estado === "activo" ? ", activa" : ""})` : ""}`,
    items: [
      { titulo: "Calificación promedio", valor: prom !== null ? `${prom}%` : "-", detalle: `${comp.length} de ${rows.length} proveedores evaluados completos`, tono: toneBy(prom, 85, 70) },
      { titulo: "Proveedores confiables (85% o más)", valor: fmtPct(conf), tono: toneBy(conf, 80, 60) },
      ...(rol === "comprador" || rol === "almacen" || rol === "supervisor_almacen"
        ? [{ titulo: "Me faltan por evaluar", valor: String(per?.estado === "activo" ? mine : 0), tono: (per?.estado === "activo" && mine > 0 ? "amber" : "green") as Tone }]
        : []),
    ],
  };
}

async function calidadGrupo(c: Ctx): Promise<Grupo> {
  const [{ data: qs }, { count: sacAb }] = await Promise.all([
    c.supabase.from("quejas").select("estado, created_at, cerrada_at").limit(10000),
    c.supabase.from("acciones_correctivas").select("id", { count: "exact", head: true }).in("estado", ["abierta", "en_proceso", "verificacion"]),
  ]);
  const q = (qs ?? []).filter((x) => x.estado !== "no_aplica");
  const mes = q.filter((x) => x.created_at >= c.m0.toUTC().toISO()!);
  const cerradas = q.filter((x) => x.cerrada_at);
  const dias = cerradas.length ? cerradas.reduce((a, x) => a + (Date.parse(x.cerrada_at!) - Date.parse(x.created_at)) / 86_400_000, 0) / cerradas.length : null;
  return {
    titulo: "Calidad",
    items: [
      { titulo: "Quejas abiertas", valor: String(q.filter((x) => x.estado !== "cerrada").length), tono: q.some((x) => x.estado !== "cerrada") ? "amber" : "green" },
      { titulo: "Quejas por revisar (¿aplican?)", valor: String(q.filter((x) => x.estado === "por_revisar").length), tono: q.some((x) => x.estado === "por_revisar") ? "red" : "green" },
      { titulo: "Quejas recibidas este mes", valor: String(mes.length) },
      { titulo: "Días promedio para cerrar una queja", valor: dias !== null ? String(Math.round(dias * 10) / 10) : "-", tono: dias === null ? "default" : dias <= 7 ? "green" : dias <= 15 ? "amber" : "red" },
      { titulo: "Acciones correctivas abiertas", valor: String(sacAb ?? 0), tono: (sacAb ?? 0) > 0 ? "amber" : "green" },
    ],
  };
}

async function guiasGrupo(c: Ctx): Promise<Grupo> {
  const { data } = await c.supabase.from("guias").select("estado, created_at, solicitada_at, lista_at").gte("created_at", c.m0.toUTC().toISO()!).limit(10000);
  const g = data ?? [];
  const listas = g.filter((x) => x.lista_at);
  const horas = listas.map((x) => (Date.parse(x.lista_at!) - Date.parse(x.created_at)) / 3_600_000);
  const avg = horas.length ? horas.reduce((a, h) => a + h, 0) / horas.length : null;
  const en24 = pct(horas.filter((h) => h <= 24).length, horas.length);
  const { count: pend } = await c.supabase.from("guias").select("id", { count: "exact", head: true }).in("estado", ["solicitada", "en_proceso", "requiere_datos"]);
  return {
    titulo: "Guías de paquetería",
    items: [
      { titulo: "Guías listas este mes", valor: String(listas.length), detalle: `${g.length} solicitadas` },
      { titulo: "Tiempo promedio para tener la guía", valor: avg !== null ? `${Math.round(avg * 10) / 10} h` : "-", tono: avg === null ? "default" : avg <= 4 ? "green" : avg <= 24 ? "amber" : "red" },
      { titulo: "Listas en menos de 24 h", valor: fmtPct(en24), tono: toneBy(en24, 95, 80) },
      { titulo: "Pendientes ahora", valor: String(pend ?? 0), tono: (pend ?? 0) > 0 ? "amber" : "green" },
    ],
  };
}

async function clientesGrupo(c: Ctx): Promise<Grupo> {
  const { data: per } = await c.supabase.from("eval_periodos").select("id, nombre, estado").eq("tipo", "clientes").neq("estado", "programado").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data } = per ? await c.supabase.from("encuestas_cliente").select("respuestas, escala, respondida_at, enviada_at").eq("periodo_id", per.id).limit(5000) : { data: [] };
  const e = data ?? [];
  const resp = e.filter((x) => x.respondida_at);
  const sat = satisfaccion(resp as { respuestas: Record<string, number>; escala: number }[]);
  return {
    titulo: `Satisfacción de clientes${per ? ` (${per.nombre})` : ""}`,
    items: [
      { titulo: "Clientes satisfechos", valor: fmtPct(sat.pct), detalle: "Satisfecho o muy satisfecho", tono: toneBy(sat.pct, 85, 70) },
      { titulo: "Índice de satisfacción", valor: fmtPct(sat.indice), detalle: "0% todo insatisfecho, 100% todo muy satisfecho", tono: toneBy(sat.indice, 70, 50) },
      { titulo: "Respuesta a la encuesta", valor: fmtPct(pct(resp.length, e.filter((x) => x.enviada_at).length)), detalle: `${resp.length} respondidas de ${e.filter((x) => x.enviada_at).length} enviadas` },
    ],
  };
}
