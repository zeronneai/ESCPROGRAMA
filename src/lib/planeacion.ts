/**
 * Planeacion de compras (solo comprador). Calculos puros: no tocan la base, se usan en el servidor y en el navegador.
 *
 * Venta real por mes = unidades vendidas / dias con existencia x 30.4 (asi el desabasto no esconde la venta).
 * Demanda para planear = venta real + crecimiento (16% por defecto, para ir subiendo stock).
 * Posicion = existencia + en camino.
 * USA:   se pide cuando la posicion no alcanza para la entrega + base; se pide hasta entrega + objetivo.
 * China: se pide cuando la posicion baja de "punto" meses; se pide hasta "cobertura" meses.
 * Siempre se redondea al empaque (cajas completas).
 */

import type { PedidoPlan } from "./pedidos";

export const DIAS_MES = 30.4;

export type Origen = "china" | "usa";
export type EstadoOc = "borrador" | "enviada" | "proforma" | "embarcada" | "recibida" | "cancelada";

export const ESTADOS_OC: Record<EstadoOc, string> = {
  borrador: "Borrador",
  enviada: "Enviada al proveedor",
  proforma: "Con proforma",
  embarcada: "Embarcada",
  recibida: "Recibida",
  cancelada: "Cancelada",
};
/** Estados que cuentan como "en camino". El borrador tambien cuenta: ya se decidio pedirlo. */
export const EN_CAMINO: EstadoOc[] = ["borrador", "enviada", "proforma", "embarcada"];

export interface PlanProveedor {
  id: string;
  nombre: string;
  codigo: string | null;
  origen: Origen;
  entrega_dias: number;
  recibe_parcial: boolean;
  tope_usd: number | null;
  contenedor_cbm: number | null;
  base_meses: number;
  objetivo_meses: number;
  punto_meses: number;
  cobertura_meses: number;
  razon_social?: string | null;
  contacto?: string | null;
  enviar_a?: string | null;
}

/** Un mes de historial: [mes "YYYY-MM", venta, traspasos, dias con existencia, dias del mes contados, existencia al cierre]. */
export type MesHist = {
  mes: string;
  venta: number;
  traspasos: number;
  dias_stock: number;
  dias: number;
  existencia_fin: number | null;
  /** Dias en que la existencia alcanzaba para un pedido normal, y lo vendido en esos dias. */
  dias_suf?: number;
  venta_suf?: number;
  tras_suf?: number;
};

export interface Llegada {
  folio: string;
  oc_id: string;
  estado: EstadoOc;
  cantidad: number;
  fecha: string; // llegada estimada YYYY-MM-DD
}

export interface ArticuloPlan {
  clave: string;
  nombre: string;
  um: string | null;
  empaque: number | null;
  cbm_empaque: number | null;
  precio: number | null;
  existencia_corte: number;
  ventas_portal: number; // vendido en el portal despues del corte
  recibido_post: number; // recibido de OCs despues del corte
  existencia: number; // corte - ventas del portal + recibido
  pedido_tipico?: number | null; // 3 de cada 4 pedidos son de esta cantidad o menos
  /** Pedidos Pegatron de linea que aun no se piden al proveedor (comprometido). */
  pegatron?: { cantidad: number; pos: string[] } | null;
  historial: MesHist[];
  llegadas: Llegada[];
  /** Pedidos activos de vendedores: unica = se aparta una vez; mensual = demanda extra por mes (semanal, mensual, anual). */
  pedidos?: { unica: number; mensual: number; lista: PedidoPlan[] } | null;
}

export interface Parametros {
  ventana: number; // meses
  crecimiento: number; // 0.16
  traspasos: boolean;
  /** Sumar los pedidos recurrentes de los vendedores a la demanda. */
  pedidos?: boolean;
}
export const PARAMETROS_BASE: Parametros = { ventana: 12, crecimiento: 0.16, traspasos: true, pedidos: true };

export type Semaforo = "rojo" | "amarillo" | "verde" | "gris";
export const SEMAFORO: Record<Semaforo, string> = {
  rojo: "Se acaba antes de que llegue",
  amarillo: "Toca pedir",
  verde: "Bien",
  gris: "Sin venta",
};

export interface Calculo {
  simple: number;
  real: number;
  sinStock: number; // 0..1, dias en cero
  bajoStock: number; // 0..1, dias sin stock suficiente para un pedido normal (incluye los de cero)
  pocosDatos: boolean;
  plan: number;
  transito: number;
  posicion: number;
  mesesInv: number;
  mesesPos: number;
  reorden: number;
  objetivo: number;
  sugerido: number;
  /** Demanda mensual extra por pedidos recurrentes de vendedores. */
  extraVend: number;
  cajas: number | null;
  cbm: number;
  importe: number;
  agota: string | null;
  semaforo: Semaforo;
}

const addDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
};
export { addDias };

/** Fecha de llegada que se usa en la proyeccion: si ya paso y no ha llegado, se supone en 15 dias. */
export function llegadaEfectiva(fecha: string, hoy: string): string {
  return fecha < hoy ? addDias(hoy, 15) : fecha;
}

/**
 * Venta real: se toma la mayor de dos medidas.
 *  1) Lo vendido / dias con existencia (los dias en cero no cuentan).
 *  2) Lo vendido en los dias con stock SUFICIENTE / esos dias: con menos de un pedido normal en el almacen
 *     tampoco se puede surtir, aunque no este en cero. Se usa si hay al menos 20 dias asi en la ventana.
 */
export function ventaReal(historial: MesHist[], p: Parametros) {
  const ms = historial.slice(-p.ventana);
  let v = 0, dcs = 0, d = 0, vs = 0, ds = 0;
  let conSuf = false;
  for (const m of ms) {
    v += m.venta + (p.traspasos ? m.traspasos : 0);
    dcs += m.dias_stock;
    d += m.dias;
    if (m.dias_suf != null) {
      conSuf = true;
      ds += m.dias_suf;
      vs += (m.venta_suf ?? 0) + (p.traspasos ? (m.tras_suf ?? 0) : 0);
    }
  }
  const simple = d ? (v / d) * DIAS_MES : 0;
  const pocosDatos = dcs < 15 && v > 0;
  const real1 = dcs >= 15 ? (v / dcs) * DIAS_MES : simple;
  const real2 = conSuf && ds >= 20 ? (vs / ds) * DIAS_MES : 0;
  const real = Math.max(real1, real2);
  const diasBuenos = conSuf ? ds : dcs;
  return { simple, real, sinStock: d ? 1 - dcs / d : 0, bajoStock: d ? 1 - diasBuenos / d : 0, pocosDatos };
}

export function redondeaEmpaque(cantidad: number, empaque: number | null): number {
  if (cantidad <= 0) return 0;
  const e = empaque && empaque > 1 ? empaque : 1;
  return Math.ceil(cantidad / e - 1e-9) * e;
}

export function calcular(a: ArticuloPlan, prov: PlanProveedor, p: Parametros, hoy: string, extra = 0): Calculo {
  const vr = ventaReal(a.historial, p);
  const extraVend = p.pedidos === false ? 0 : (a.pedidos?.mensual ?? 0);
  const plan = vr.real * (1 + p.crecimiento) + extraVend;
  const leadM = prov.entrega_dias / DIAS_MES;
  const transito = a.llegadas.reduce((s, l) => s + l.cantidad, 0);
  const comprometido = (a.pegatron?.cantidad ?? 0) + (a.pedidos?.unica ?? 0);
  const posicion = a.existencia + transito - comprometido;
  const china = prov.origen === "china";
  const reorden = china ? plan * prov.punto_meses : plan * (leadM + prov.base_meses);
  const objetivo = china ? plan * prov.cobertura_meses : plan * (leadM + prov.objetivo_meses);
  // Un pedido especial que no alcanza con lo que hay se pide aunque el articulo no tenga venta.
  const necesita = plan > 0 && posicion < reorden ? objetivo - posicion : posicion < 0 ? -posicion : 0;
  const sugerido = redondeaEmpaque(necesita, a.empaque) + extra;
  // Proyeccion mes a mes: cuando se acaba (con lo que viene en camino, sin lo sugerido).
  let agota: string | null = null;
  if (plan > 0) {
    let s = a.existencia;
    const lls = a.llegadas.map((l) => ({ f: llegadaEfectiva(l.fecha, hoy), u: l.cantidad }));
    for (let k = 0; k < 24; k++) {
      const ini = addDias(hoy, k * DIAS_MES);
      const fin = addDias(hoy, (k + 1) * DIAS_MES);
      for (const l of lls) if (l.f >= ini && l.f < fin) s += l.u;
      s -= plan;
      if (s < 0) {
        agota = addDias(ini, DIAS_MES * (1 + s / plan));
        break;
      }
    }
  }
  const llegariaHoy = addDias(hoy, prov.entrega_dias);
  let semaforo: Semaforo;
  if (plan <= 0) semaforo = posicion < 0 ? "amarillo" : "gris";
  else if (agota && agota < llegariaHoy) semaforo = "rojo";
  else if (posicion < reorden) semaforo = "amarillo";
  else semaforo = "verde";
  const emp = a.empaque && a.empaque > 1 ? a.empaque : null;
  return {
    ...vr,
    plan,
    transito,
    posicion,
    mesesInv: plan > 0 ? a.existencia / plan : Infinity,
    mesesPos: plan > 0 ? posicion / plan : Infinity,
    reorden,
    objetivo,
    sugerido,
    extraVend,
    cajas: emp ? sugerido / emp : null,
    cbm: emp && a.cbm_empaque ? (sugerido / emp) * a.cbm_empaque : 0,
    importe: sugerido * (a.precio ?? 0),
    agota,
    semaforo,
  };
}

/**
 * Llenar contenedor: agrega cajas una por una al articulo con menos meses de posicion (contando lo sugerido)
 * hasta que ya no quepa otra caja. Devuelve las cajas extra (en unidades) por clave.
 */
export function rellenarContenedor(arts: ArticuloPlan[], prov: PlanProveedor, p: Parametros, hoy: string): Record<string, number> {
  const cap = prov.contenedor_cbm ?? 0;
  const extra: Record<string, number> = {};
  if (!cap) return extra;
  const base = new Map(arts.map((a) => [a.clave, calcular(a, prov, p, hoy)]));
  const candidatos = arts.filter((a) => a.empaque && a.empaque > 0 && a.cbm_empaque && (base.get(a.clave)?.plan ?? 0) > 0);
  let total = [...base.values()].reduce((s, c) => s + c.cbm, 0);
  for (let guard = 0; guard < 20000 && candidatos.length; guard++) {
    candidatos.sort((x, y) => {
      const cx = base.get(x.clave)!;
      const cy = base.get(y.clave)!;
      return (cx.posicion + cx.sugerido + (extra[x.clave] ?? 0)) / cx.plan - (cy.posicion + cy.sugerido + (extra[y.clave] ?? 0)) / cy.plan;
    });
    const a = candidatos[0];
    if (total + a.cbm_empaque! > cap) break;
    extra[a.clave] = (extra[a.clave] ?? 0) + a.empaque!;
    total += a.cbm_empaque!;
  }
  return extra;
}

/** Folio con la formula del comprador: ano (2 digitos) + siglas del proveedor + mes + dia. Ej. 26JGH1104. */
export function folioOc(codigo: string, fechaIso: string, usados: string[] = []): string {
  const base = `${fechaIso.slice(2, 4)}${codigo}${fechaIso.slice(5, 7)}${fechaIso.slice(8, 10)}`;
  if (!usados.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!usados.includes(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now() % 1000}`;
}

/** Fecha de la OC a partir de su folio (26JGH0629 -> 2026-06-29). */
export function fechaDeFolio(folio: string): string | null {
  const m = folio.replace(/^PO\s*/i, "").match(/^(\d{2})[A-Z]{2,4}(\d{2})(\d{2})/);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Historial que incluye las ventas del portal despues del corte: se suman a su mes y los dias despues del
 * corte se cuentan como dias con existencia si hoy hay existencia.
 */
export function historialConPortal(historial: MesHist[], corte: string, hoy: string, ventas: { fecha: string; cantidad: number }[], hayStock: boolean): MesHist[] {
  const mapa = new Map(historial.map((m) => [m.mes, { ...m }]));
  let d = addDias(corte, 1);
  while (d <= hoy) {
    const mes = d.slice(0, 7);
    const m = mapa.get(mes) ?? { mes, venta: 0, traspasos: 0, dias_stock: 0, dias: 0, existencia_fin: null, dias_suf: 0, venta_suf: 0, tras_suf: 0 };
    m.dias += 1;
    if (hayStock) {
      m.dias_stock += 1;
      if (m.dias_suf != null) m.dias_suf += 1;
    }
    mapa.set(mes, m);
    d = addDias(d, 1);
  }
  for (const v of ventas) {
    if (v.fecha <= corte) continue;
    const mes = v.fecha.slice(0, 7);
    const m = mapa.get(mes);
    if (m) {
      m.venta += v.cantidad;
      if (m.venta_suf != null && hayStock) m.venta_suf += v.cantidad;
    }
  }
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

export const fmtNum = (n: number | null | undefined, dec = 0) =>
  n == null || !isFinite(n) ? "" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: dec, minimumFractionDigits: dec });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fechaCortaMx = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${MESES[Number(m) - 1]}/${y.slice(2)}`;
};
export const mesCorto = (mes: string) => MESES[Number(mes.slice(5, 7)) - 1];
