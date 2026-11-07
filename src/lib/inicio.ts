import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import type { IconName } from "@/components/icons";
import type { Rol } from "@/lib/auth/route-guard";
import { fmtTotales, totalesPorMoneda } from "@/lib/pagos";
import { cobroEstado, money, saldo, type VentaRow } from "@/lib/ventas";

/**
 * Tablero de inicio por puesto: avisos urgentes arriba y tarjetas por seccion.
 * Todo se lee con la sesion del usuario, asi que cada quien ve solo lo que la base le permite.
 */
export type Tono = "red" | "amber" | "green" | "default";
export interface Metrica {
  label: string;
  valor: string | number;
  tono?: Tono;
  hint?: string;
  href?: string;
}
export interface Seccion {
  id: string;
  titulo: string;
  icon: IconName;
  href: string;
  metricas: Metrica[];
}
export interface Alerta {
  texto: string;
  href: string;
  tono: "red" | "amber";
}
export interface Tablero {
  alertas: Alerta[];
  secciones: Seccion[];
}

type Ctx = { sb: SupabaseClient; uid: string; rol: Rol; today: string; tz: string; nowIso: string };
type Bloque = { seccion: Seccion | null; alertas: Alerta[] };

const n = (x: number | null | undefined) => x ?? 0;
const tonoSi = (v: number, t: Tono = "amber"): Tono => (v > 0 ? t : "default");

async function contar(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await q;
  return n(count);
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

async function cotizacionesVendedor(c: Ctx): Promise<Bloque> {
  const [borradores, { data }] = await Promise.all([
    contar(c.sb.from("quote_requests").select("id", { count: "exact", head: true }).eq("vendedor_id", c.uid).eq("estado", "borrador").is("archived_at", null)),
    c.sb
      .from("quote_items")
      .select("estado, item_outcomes(resultado, quote_version), quote_requests!quote_items_request_id_fkey!inner(vendedor_id, estado, archived_at)")
      .eq("quote_requests.vendedor_id", c.uid)
      .eq("quote_requests.estado", "enviada")
      .is("quote_requests.archived_at", null)
      .limit(5000),
  ]);
  const items = (data ?? []) as unknown as { estado: string; item_outcomes: { resultado: string; quote_version: number }[] }[];
  const acl = items.filter((i) => i.estado === "esperando_aclaracion").length;
  const porEnviar = items.filter((i) => i.estado === "cotizada").length;
  const conCompras = items.filter((i) => i.estado === "pendiente" || i.estado === "actualizacion_solicitada").length;
  const conCliente = items.filter((i) => {
    if (i.estado !== "enviada_cliente") return false;
    const last = [...i.item_outcomes].sort((a, b) => b.quote_version - a.quote_version)[0];
    return !last || last.resultado === "sin_respuesta";
  }).length;
  const alertas: Alerta[] = [];
  if (acl) alertas.push({ texto: `Compras te pidió aclaración en ${acl} partida(s)`, href: "/vendedor", tono: "red" });
  if (porEnviar) alertas.push({ texto: `${porEnviar} partida(s) con precio, listas para enviar al cliente`, href: "/vendedor", tono: "amber" });
  return {
    alertas,
    seccion: {
      id: "cotizaciones", titulo: "Mis cotizaciones", icon: "list", href: "/vendedor",
      metricas: [
        { label: "Responder aclaración", valor: acl, tono: tonoSi(acl, "red") },
        { label: "Listas para enviar", valor: porEnviar, tono: tonoSi(porEnviar) },
        { label: "Con compras", valor: conCompras },
        { label: "Con el cliente", valor: conCliente, hint: "Esperando respuesta" },
        ...(borradores ? [{ label: "Borradores sin enviar", valor: borradores, tono: "amber" as Tono }] : []),
      ],
    },
  };
}

async function cotizacionesCompras(c: Ctx, lectura: boolean): Promise<Bloque> {
  const { data } = await c.sb
    .from("quote_requests")
    .select("id, due_at, quote_items!quote_items_request_id_fkey(estado)")
    .eq("estado", "enviada")
    .is("archived_at", null)
    .limit(3000);
  const rows = ((data ?? []) as unknown as { id: string; due_at: string | null; quote_items: { estado: string }[] | null }[]).map((r) => ({ ...r, quote_items: r.quote_items ?? [] }));
  const conPend = rows.filter((r) => r.quote_items.some((i) => i.estado === "pendiente"));
  const pend = rows.reduce((a, r) => a + r.quote_items.filter((i) => i.estado === "pendiente").length, 0);
  const act = rows.reduce((a, r) => a + r.quote_items.filter((i) => i.estado === "actualizacion_solicitada").length, 0);
  const acl = rows.reduce((a, r) => a + r.quote_items.filter((i) => i.estado === "esperando_aclaracion").length, 0);
  const vencidas = conPend.filter((r) => r.due_at && r.due_at < c.nowIso).length;
  const pronto = conPend.filter((r) => r.due_at && r.due_at >= c.nowIso && r.due_at < DateTime.fromISO(c.nowIso).plus({ hours: 24 }).toISO()!).length;
  const href = lectura ? "/indicadores" : "/comprador";
  const alertas: Alerta[] = [];
  if (vencidas) alertas.push({ texto: `${vencidas} solicitud(es) de cotización fuera de plazo`, href, tono: "red" });
  if (!lectura && act) alertas.push({ texto: `${act} actualización(es) de precio solicitadas por ventas`, href, tono: "amber" });
  return {
    alertas,
    seccion: {
      id: "cotizaciones", titulo: lectura ? "Cotizaciones (compras)" : "Cotizaciones por atender", icon: "inbox", href,
      metricas: [
        { label: "Partidas por cotizar", valor: pend, tono: tonoSi(pend), hint: `${conPend.length} solicitud(es)` },
        { label: "Fuera de plazo", valor: vencidas, tono: tonoSi(vencidas, "red") },
        { label: "Vencen en 24 h", valor: pronto, tono: tonoSi(pronto) },
        { label: "Actualizaciones de precio", valor: act, tono: tonoSi(act) },
        { label: "Esperando aclaración", valor: acl, hint: "De parte del vendedor" },
      ],
    },
  };
}

async function ventas(c: Ctx, propias: boolean): Promise<Bloque> {
  const mesIni = c.today.slice(0, 8) + "01";
  let q = c.sb.from("ventas").select("vendedor_id, fecha, monto, moneda, pago, vence, porcentaje_cobrado, cancelada_at, entregado, tipo").is("cancelada_at", null);
  if (propias) q = q.eq("vendedor_id", c.uid);
  const { data } = await q.or(`fecha.gte.${mesIni},porcentaje_cobrado.lt.100`).limit(20000);
  const all = (data ?? []) as unknown as (VentaRow & { entregado: boolean })[];
  const vs = all.filter((v) => v.tipo !== "visita");
  const mes = vs.filter((v) => v.fecha >= mesIni);
  const hoy = vs.filter((v) => v.fecha === c.today);
  const visitas = all.filter((v) => v.tipo === "visita" && v.fecha >= mesIni).length;
  const mxn = (l: VentaRow[]) => l.filter((v) => v.moneda === "MXN").reduce((a, v) => a + Number(v.monto ?? 0), 0);
  const vencidas = vs.filter((v) => cobroEstado(v, c.today) === "vencida");
  const carteraVencida = vencidas.reduce((a, v) => a + saldo(v), 0);
  const porCobrar = vs.filter((v) => cobroEstado(v, c.today) === "por_cobrar").reduce((a, v) => a + saldo(v), 0);
  const porEntregar = vs.filter((v) => !v.entregado).length;
  const href = propias ? "/vendedor/bitacora" : "/ventas";
  const alertas: Alerta[] = [];
  if (vencidas.length) alertas.push({ texto: `Cartera vencida: ${money(carteraVencida)} en ${vencidas.length} venta(s)`, href: propias ? "/vendedor/bitacora?ver=vencidas" : "/ventas", tono: "red" });
  if (propias && !hoy.length && DateTime.now().setZone(c.tz).hour >= 12) alertas.push({ texto: "Aún no registras ventas ni visitas hoy", href: "/vendedor/bitacora", tono: "amber" });
  return {
    alertas,
    seccion: {
      id: "ventas", titulo: propias ? "Mis ventas" : "Ventas del equipo", icon: "target", href,
      metricas: [
        { label: "Vendido en el mes", valor: money(mxn(mes)), hint: `${mes.length} venta(s) · ${visitas} visita(s) sin venta` },
        { label: "Ventas hoy", valor: hoy.length, hint: hoy.length ? money(mxn(hoy)) : undefined, tono: hoy.length ? "green" : "default" },
        { label: "Cartera vencida", valor: money(carteraVencida), tono: carteraVencida > 0 ? "red" : "green" },
        { label: "Por cobrar al corriente", valor: money(porCobrar) },
        { label: "Por entregar", valor: porEntregar, tono: tonoSi(porEntregar) },
      ],
    },
  };
}

async function prospeccion(c: Ctx, propias: boolean): Promise<Bloque> {
  let q = c.sb.from("bitacora").select("vendedor_id, resultado, proximo_seguimiento").is("archived_at", null).eq("resultado", "abierta");
  if (propias) q = q.or(`vendedor_id.eq.${c.uid},vendedor_id.is.null`);
  const { data } = await q.limit(10000);
  const rows = (data ?? []) as { vendedor_id: string | null; proximo_seguimiento: string | null }[];
  const mios = propias ? rows.filter((r) => r.vendedor_id === c.uid) : rows;
  const atrasados = mios.filter((r) => r.proximo_seguimiento && r.proximo_seguimiento < c.today).length;
  const hoy = mios.filter((r) => r.proximo_seguimiento === c.today).length;
  const sinVendedor = rows.filter((r) => !r.vendedor_id).length;
  const href = propias ? "/vendedor/bitacora?tab=prospeccion" : "/ventas";
  const alertas: Alerta[] = [];
  if (atrasados) alertas.push({ texto: `${atrasados} prospecto(s) con seguimiento atrasado`, href: propias ? "/vendedor/bitacora?tab=prospeccion&grupo=seguimiento" : href, tono: "amber" });
  if (propias && sinVendedor) alertas.push({ texto: `${sinVendedor} prospecto(s) del sitio web sin vendedor`, href, tono: "amber" });
  return {
    alertas,
    seccion: {
      id: "prospeccion", titulo: propias ? "Mi prospección" : "Prospección del equipo", icon: "users", href,
      metricas: [
        { label: "Prospectos activos", valor: mios.length },
        { label: "Seguimiento hoy", valor: hoy, tono: tonoSi(hoy) },
        { label: "Seguimiento atrasado", valor: atrasados, tono: tonoSi(atrasados, "red") },
        ...(sinVendedor ? [{ label: "Del sitio web sin vendedor", valor: sinVendedor, tono: "amber" as Tono }] : []),
      ],
    },
  };
}

async function calidad(c: Ctx, propias: boolean): Promise<Bloque> {
  const [{ data: qs }, { data: sacs }] = await Promise.all([
    (propias ? c.sb.from("quejas").select("estado, fecha_recepcion").or(`vendedor_id.eq.${c.uid},created_by.eq.${c.uid}`) : c.sb.from("quejas").select("estado, fecha_recepcion")).neq("estado", "cerrada").limit(5000),
    propias ? Promise.resolve({ data: [] }) : c.sb.from("acciones_correctivas").select("estado").not("estado", "in", "(cerrada,cancelada)").limit(5000),
  ]);
  const quejas = (qs ?? []) as { estado: string; fecha_recepcion: string }[];
  const abiertas = quejas.filter((q) => q.estado === "abierta").length;
  const analisis = quejas.filter((q) => q.estado === "en_analisis" || q.estado === "con_sac").length;
  const viejas = quejas.filter((q) => q.estado === "abierta" && q.fecha_recepcion <= DateTime.fromISO(c.today).minus({ days: 3 }).toISODate()!).length;
  const sacAbiertas = (sacs ?? []).length;
  const alertas: Alerta[] = [];
  if (!propias && abiertas) alertas.push({ texto: `${abiertas} queja(s) de cliente sin atender${viejas ? ` (${viejas} con más de 3 días)` : ""}`, href: "/calidad", tono: viejas ? "red" : "amber" });
  return {
    alertas,
    seccion: {
      id: "calidad", titulo: propias ? "Mis quejas de cliente" : "Quejas y acciones correctivas", icon: "alert", href: "/calidad",
      metricas: [
        { label: "Quejas abiertas", valor: abiertas, tono: tonoSi(abiertas, viejas ? "red" : "amber") },
        { label: "En análisis o con AC", valor: analisis },
        ...(propias ? [] : [{ label: "Acciones correctivas abiertas", valor: sacAbiertas, tono: tonoSi(sacAbiertas) }]),
      ],
    },
  };
}

async function guias(c: Ctx, propias: boolean, mkt: boolean): Promise<Bloque> {
  let q = c.sb.from("guias").select("estado, solicitada_at, urgente, lista_at").in("estado", ["solicitada", "en_proceso", "requiere_datos", "lista"]);
  if (propias) q = q.eq("vendedor_id", c.uid);
  const { data } = await q.limit(5000);
  const rows = (data ?? []) as { estado: string; solicitada_at: string; urgente: boolean; lista_at: string | null }[];
  const abiertas = rows.filter((g) => g.estado === "solicitada" || g.estado === "en_proceso");
  const hace2 = DateTime.fromISO(c.nowIso).minus({ hours: 2 }).toISO()!;
  const mas24 = abiertas.filter((g) => g.solicitada_at < hace2).length;
  const urgentes = abiertas.filter((g) => g.urgente).length;
  const faltan = rows.filter((g) => g.estado === "requiere_datos").length;
  const hoyIni = DateTime.fromISO(c.today, { zone: c.tz }).startOf("day").toUTC().toISO()!;
  const listasHoy = rows.filter((g) => g.estado === "lista" && g.lista_at && g.lista_at >= hoyIni).length;
  const alertas: Alerta[] = [];
  if (mas24) alertas.push({ texto: `${mas24} guía(s) con más de 2 horas sin salir`, href: "/guias", tono: "red" });
  if (mkt && urgentes) alertas.push({ texto: `${urgentes} guía(s) urgentes por atender`, href: "/guias", tono: "red" });
  if (propias && faltan) alertas.push({ texto: `Marketplaces pide datos en ${faltan} guía(s)`, href: "/guias", tono: "red" });
  return {
    alertas,
    seccion: {
      id: "guias", titulo: propias ? "Mis guías" : "Guías de paquetería", icon: "package", href: "/guias",
      metricas: [
        { label: mkt ? "Por atender" : "En proceso", valor: abiertas.length, tono: tonoSi(abiertas.length) },
        { label: "Más de 2 h", valor: mas24, tono: tonoSi(mas24, "red") },
        { label: "Urgentes", valor: urgentes, tono: tonoSi(urgentes, "red") },
        { label: "Faltan datos", valor: faltan, tono: tonoSi(faltan, propias ? "red" : "amber") },
        { label: "Listas hoy", valor: listasHoy, tono: listasHoy ? "green" : "default" },
      ],
    },
  };
}

async function consumo(c: Ctx, modo: "propio" | "aprobar" | "atender" | "lectura"): Promise<Bloque> {
  const { data } = await c.sb.from("consumo_solicitudes").select("estado, solicitante_id, urgente, fecha_programada").in("estado", ["por_aprobar", "aprobada", "en_proceso"]).limit(5000);
  const rows = (data ?? []) as { estado: string; solicitante_id: string; urgente: boolean; fecha_programada: string | null }[];
  const mias = rows.filter((r) => r.solicitante_id === c.uid);
  const porAprobar = rows.filter((r) => r.estado === "por_aprobar").length;
  const aprobadas = rows.filter((r) => r.estado === "aprobada").length;
  const enProceso = rows.filter((r) => r.estado === "en_proceso").length;
  const urgentes = rows.filter((r) => r.urgente && r.estado !== "en_proceso").length;
  const alertas: Alerta[] = [];
  if (modo === "aprobar" && porAprobar) alertas.push({ texto: `${porAprobar} solicitud(es) de consumo interno por aprobar`, href: "/consumo", tono: "amber" });
  if (modo === "atender" && aprobadas) alertas.push({ texto: `${aprobadas} solicitud(es) de consumo aprobadas por atender${urgentes ? ` (${urgentes} urgentes)` : ""}`, href: "/consumo", tono: urgentes ? "red" : "amber" });
  const metricas: Metrica[] =
    modo === "propio"
      ? [
          { label: "Mis solicitudes por aprobar", valor: mias.filter((r) => r.estado === "por_aprobar").length },
          { label: "Aprobadas", valor: mias.filter((r) => r.estado === "aprobada").length },
          { label: "En proceso", valor: mias.filter((r) => r.estado === "en_proceso").length },
        ]
      : [
          { label: "Por aprobar", valor: porAprobar, tono: modo === "aprobar" ? tonoSi(porAprobar) : "default" },
          { label: "Aprobadas por atender", valor: aprobadas, tono: modo === "atender" ? tonoSi(aprobadas) : "default" },
          { label: "En proceso", valor: enProceso },
          { label: "Urgentes", valor: urgentes, tono: tonoSi(urgentes, "red") },
        ];
  return { alertas, seccion: { id: "consumo", titulo: modo === "propio" ? "Mi consumo interno" : "Consumo interno", icon: "clipboard", href: "/consumo", metricas } };
}

async function pagos(c: Ctx): Promise<Bloque> {
  const { data } = await c.sb.from("pagos").select("estado, monto, anticipo_aplicado, fecha_limite, urgente, carga, pago_fecha, pago_monto, ordenes_compra(moneda)").in("estado", ["pendiente", "pagado"]).limit(10000);
  const rows = (data ?? []) as unknown as { estado: string; monto: number | null; anticipo_aplicado: number | null; fecha_limite: string | null; urgente: boolean; carga: string; ordenes_compra: { moneda: string } | null }[];
  const pend = rows.filter((p) => p.estado === "pendiente");
  const urg = pend.filter((p) => p.urgente).length;
  const venc = pend.filter((p) => p.fecha_limite && p.fecha_limite < c.today).length;
  const sinLib = pend.filter((p) => p.carga === "sin_liberar").length;
  const pagados = rows.filter((p) => p.estado === "pagado").length;
  const total = fmtTotales(totalesPorMoneda(pend.map((p) => ({ monto: Number(p.monto ?? 0) - Number(p.anticipo_aplicado ?? 0), moneda: p.ordenes_compra?.moneda ?? "USD" }))));
  const ceo = c.rol === "ceo";
  const alertas: Alerta[] = [];
  if (urg) alertas.push({ texto: `${urg} pago(s) a proveedor marcados URGENTE`, href: "/pagos?ver=por_pagar", tono: "red" });
  if (venc) alertas.push({ texto: `${venc} pago(s) a proveedor con fecha límite vencida`, href: "/pagos?ver=por_pagar", tono: "red" });
  if (ceo && pend.length && !urg && !venc) alertas.push({ texto: `${pend.length} pago(s) a proveedores por hacer (${total})`, href: "/pagos?ver=por_pagar", tono: "amber" });
  if (!ceo && pagados) alertas.push({ texto: `${pagados} comprobante(s) de pago por descargar y mandar al proveedor`, href: "/pagos?ver=comprobantes", tono: "amber" });
  return {
    alertas,
    seccion: {
      id: "pagos", titulo: "Pagos a proveedores extranjeros", icon: "dollar", href: "/pagos",
      metricas: [
        { label: "Por pagar", valor: pend.length, hint: total, tono: tonoSi(pend.length, ceo ? "red" : "amber"), href: "/pagos?ver=por_pagar" },
        { label: "Urgentes", valor: urg, tono: tonoSi(urg, "red") },
        { label: "Vencidos", valor: venc, tono: tonoSi(venc, "red") },
        { label: "Carga sin liberar", valor: sinLib, tono: tonoSi(sinLib) },
        { label: ceo ? "Pagados, compras no descarga" : "Comprobantes por descargar", valor: pagados, tono: !ceo ? tonoSi(pagados) : "default", href: "/pagos?ver=comprobantes" },
      ],
    },
  };
}

async function entregas(c: Ctx, modo: "almacen" | "propias"): Promise<Bloque> {
  let q = c.sb.from("salidas").select("estado, incompleta, espera, cargada_at, created_by, created_at").neq("estado", "cancelada").order("created_at", { ascending: false });
  if (modo === "propias") q = q.eq("created_by", c.uid);
  const { data } = await q.limit(3000);
  const rows = (data ?? []) as { estado: string; incompleta: boolean; espera: boolean; cargada_at: string | null; created_at: string }[];
  if (modo === "propias" && !rows.length) return { alertas: [], seccion: null };
  const pend = rows.filter((s) => s.estado === "por_cargar" || s.estado === "cargando");
  const hoyIni = DateTime.fromISO(c.today, { zone: c.tz }).startOf("day").toUTC().toISO()!;
  const hace24 = DateTime.fromISO(c.nowIso).minus({ hours: 24 }).toISO()!;
  const viejas = pend.filter((s) => s.created_at < hace24).length;
  const cargadasHoy = rows.filter((s) => s.estado === "cargada" && s.cargada_at && s.cargada_at >= hoyIni).length;
  const espera = pend.filter((s) => s.espera).length;
  const alertas: Alerta[] = [];
  const listas = pend.length - espera;
  if (modo === "almacen" && listas) alertas.push({ texto: `${listas} factura(s) por cargar${viejas ? ` (${viejas} con más de 24 h)` : ""}`, href: "/entregas", tono: viejas ? "red" : "amber" });
  if (espera) alertas.push({ texto: modo === "almacen" ? `${espera} factura(s) en espera por falta de material` : `Almacén no tiene material para ${espera} de tus entregas`, href: "/entregas", tono: modo === "almacen" ? "amber" : "red" });
  const metricas: Metrica[] = [
    { label: "Por cargar", valor: pend.length, tono: modo === "almacen" ? tonoSi(pend.length) : "default", href: "/entregas" },
    { label: "Más de 24 h", valor: viejas, tono: tonoSi(viejas, "red") },
    { label: "Cargadas hoy", valor: cargadasHoy, tono: cargadasHoy ? "green" : "default", href: "/entregas?ver=cargadas" },
    { label: "En espera (sin material)", valor: espera, tono: tonoSi(espera, "red") },
  ];
  if (modo === "almacen") {
    const [recHoy, enAlmacen] = await Promise.all([
      contar(c.sb.from("recepciones").select("id", { count: "exact", head: true }).eq("fecha", c.today)),
      contar(c.sb.from("etiquetas").select("id", { count: "exact", head: true }).eq("estado", "almacen")),
    ]);
    metricas.push({ label: "Recepciones hoy", valor: recHoy, href: "/almacen/recepciones" }, { label: "Piezas en almacén", valor: enAlmacen, href: "/almacen/inventario" });
  }
  return { alertas, seccion: { id: "entregas", titulo: modo === "almacen" ? "Entregas e inventario" : "Mis entregas", icon: "truck", href: "/entregas", metricas } };
}

async function evalProveedores(c: Ctx): Promise<Bloque> {
  const { data: per } = await c.sb.from("eval_periodos").select("id, nombre").eq("tipo", "proveedores").eq("estado", "activo").maybeSingle();
  if (!per) return { alertas: [], seccion: null };
  const { data } = await c.sb.from("eval_proveedor").select("comprador_at, almacen_at").eq("periodo_id", per.id).limit(5000);
  const rows = (data ?? []) as { comprador_at: string | null; almacen_at: string | null }[];
  const almacen = c.rol === "almacen" || c.rol === "supervisor_almacen";
  const mias = rows.filter((r) => (almacen ? !r.almacen_at : !r.comprador_at)).length;
  const completas = rows.filter((r) => r.comprador_at && r.almacen_at).length;
  const evalua = almacen || c.rol === "comprador";
  const alertas: Alerta[] = evalua && mias ? [{ texto: `Te faltan ${mias} proveedor(es) por evaluar (${per.nombre})`, href: "/evaluaciones/proveedores", tono: "amber" }] : [];
  return {
    alertas,
    seccion: {
      id: "eval-prov", titulo: `Evaluación de proveedores · ${per.nombre}`, icon: "truck", href: "/evaluaciones/proveedores",
      metricas: [
        ...(evalua ? [{ label: "Me faltan", valor: mias, tono: tonoSi(mias) }] : []),
        { label: "Completas", valor: `${completas} de ${rows.length}`, tono: rows.length && completas === rows.length ? "green" : "default" },
      ],
    },
  };
}

async function encuesta(c: Ctx, propias: boolean): Promise<Bloque> {
  const { data: per } = await c.sb.from("eval_periodos").select("id, nombre, cierra_el").eq("tipo", "clientes").eq("estado", "activo").maybeSingle();
  if (!per) return { alertas: [], seccion: null };
  let q = c.sb.from("encuestas_cliente").select("enviada_at, respondida_at, respuestas, escala").eq("periodo_id", per.id);
  if (propias) q = q.eq("vendedor_id", c.uid);
  const { data } = await q.limit(5000);
  const rows = (data ?? []) as { enviada_at: string | null; respondida_at: string | null; respuestas: Record<string, number>; escala: number }[];
  const recibidas = rows.filter((r) => r.respondida_at);
  let ok = 0;
  let tot = 0;
  for (const r of recibidas) for (const v of Object.values(r.respuestas ?? {})) {
    tot++;
    if (Number(v) >= (r.escala === 3 ? 2 : 3)) ok++;
  }
  const sat = tot ? Math.round((ok / tot) * 100) : null;
  const dias = per.cierra_el ? Math.round(DateTime.fromISO(per.cierra_el).diff(DateTime.fromISO(c.today), "days").days) : null;
  const alertas: Alerta[] = [];
  if (propias && dias !== null && dias <= 30 && rows.filter((r) => !r.enviada_at).length + (rows.length ? 0 : 1) > 0)
    alertas.push({ texto: `La encuesta de satisfacción cierra en ${dias} día(s): manda los links que faltan`, href: "/evaluaciones/clientes", tono: "amber" });
  return {
    alertas,
    seccion: {
      id: "encuesta", titulo: "Encuesta de satisfacción de clientes", icon: "users", href: "/evaluaciones/clientes",
      metricas: [
        { label: propias ? "Mis links enviados" : "Enviadas", valor: rows.filter((r) => r.enviada_at).length },
        { label: "Recibidas", valor: recibidas.length, tono: recibidas.length ? "green" : "default" },
        { label: "Satisfacción", valor: sat === null ? "-" : `${sat}%`, tono: sat === null ? "default" : sat >= 85 ? "green" : sat >= 70 ? "amber" : "red" },
        ...(per.cierra_el ? [{ label: "Cierra", valor: DateTime.fromISO(per.cierra_el).setLocale("es-MX").toFormat("d LLL yyyy") }] : []),
      ],
    },
  };
}

async function controlCambios(c: Ctx): Promise<Bloque> {
  const [enProceso, docs] = await Promise.all([
    contar(c.sb.from("control_cambios").select("id", { count: "exact", head: true }).eq("estado", "en_proceso")),
    contar(c.sb.from("documentos").select("id", { count: "exact", head: true }).eq("vigente", true)),
  ]);
  return {
    alertas: [],
    seccion: {
      id: "cambios", titulo: "Control de cambios y documentos", icon: "history", href: "/calidad/cambios",
      metricas: [
        { label: "Cambios en proceso", valor: enProceso, tono: tonoSi(enProceso), href: "/calidad/cambios?ver=en_proceso" },
        { label: "Documentos vigentes", valor: docs, href: "/documentos" },
      ],
    },
  };
}

/** Siempre: minutas por firmar. */
async function generales(c: Ctx): Promise<Alerta[]> {
  const { data: firmas } = await c.sb.from("minuta_firmas").select("minuta_id, minutas!inner(estado)").eq("user_id", c.uid).is("firmada_at", null).eq("minutas.estado", "enviada");
  const nf = (firmas ?? []).length;
  return nf ? [{ texto: `Tienes ${nf} minuta(s) por firmar`, href: "/minutas?ver=pendientes", tono: "amber" }] : [];
}

/** Seccion informativa: se muestra el resumen pero sus avisos no son tarea de este puesto. */
const soloResumen = async (b: Promise<Bloque>): Promise<Bloque> => ({ ...(await b), alertas: [] });

// ---------------------------------------------------------------------------
// Que ve cada puesto (en orden de prioridad)
// ---------------------------------------------------------------------------

export async function cargarTablero(sb: SupabaseClient, uid: string, rol: Rol, tz: string): Promise<Tablero> {
  const now = DateTime.now().setZone(tz);
  const c: Ctx = { sb, uid, rol, tz, today: now.toISODate()!, nowIso: now.toUTC().toISO()! };
  const plan: Promise<Bloque>[] = (() => {
    switch (rol) {
      case "vendedor":
        return [cotizacionesVendedor(c), ventas(c, true), prospeccion(c, true), guias(c, true, false), entregas(c, "propias"), encuesta(c, true), calidad(c, true), consumo(c, "propio")];
      case "comprador":
        return [cotizacionesCompras(c, false), pagos(c), consumo(c, "atender"), evalProveedores(c), soloResumen(ventas(c, false)), soloResumen(calidad(c, false)), controlCambios(c)];
      case "jefe_ventas":
        return [ventas(c, false), consumo(c, "aprobar"), prospeccion(c, false), encuesta(c, false), guias(c, false, false), calidad(c, false)];
      case "ceo":
        return [pagos(c), ventas(c, false), cotizacionesCompras(c, true), calidad(c, false), guias(c, false, false), consumo(c, "lectura"), encuesta(c, false), evalProveedores(c), controlCambios(c)];
      case "gerente":
        return [ventas(c, false), cotizacionesCompras(c, true), calidad(c, false), guias(c, false, false), consumo(c, "lectura"), prospeccion(c, false), encuesta(c, false), evalProveedores(c), controlCambios(c)];
      case "coordinador_iso":
        return [calidad(c, false), controlCambios(c), encuesta(c, false), evalProveedores(c), soloResumen(ventas(c, false)), soloResumen(guias(c, false, false))];
      case "marketplaces":
        return [guias(c, false, true), entregas(c, "propias"), consumo(c, "propio")];
      case "almacen":
      case "supervisor_almacen":
        return [entregas(c, "almacen"), evalProveedores(c), consumo(c, "propio")];
      case "supervisor_finanzas":
        return [consumo(c, "propio")];
      default:
        return [];
    }
  })();
  const [bloques, gen] = await Promise.all([Promise.all(plan), generales(c)]);
  const alertas = [...bloques.flatMap((b) => b.alertas), ...gen];
  alertas.sort((a, b) => Number(a.tono !== "red") - Number(b.tono !== "red"));
  return { alertas, secciones: bloques.map((b) => b.seccion).filter((s): s is Seccion => !!s) };
}
