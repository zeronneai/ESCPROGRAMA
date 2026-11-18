import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import {
  addDias,
  EN_CAMINO,
  historialConPortal,
  type ArticuloPlan,
  type EstadoOc,
  type Llegada,
  type MesHist,
  type PlanProveedor,
} from "./planeacion";

export const ZONA = "America/Chihuahua";
export const hoyMx = () => DateTime.now().setZone(ZONA).toISODate()!;

export interface OcResumen {
  id: string;
  folio: string;
  proveedor_id: string;
  fecha: string;
  estado: EstadoOc;
  llegada_estimada: string | null;
  recibida_fecha: string | null;
  origen: "excel" | "portal";
  lineas: number;
  piezas: number;
  importe: number;
}

export interface DatosPlaneacion {
  corte: string | null;
  hoy: string;
  proveedores: PlanProveedor[];
  articulos: (ArticuloPlan & { proveedor_id: string })[];
  ocs: OcResumen[];
  ventasPortal: number; // renglones de venta del portal despues del corte
}

/** Trae todos los renglones (Supabase regresa 1000 por consulta). */
async function todas<T>(hacer: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 100; i++) {
    const { data, error } = await hacer(i * 1000, i * 1000 + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function cargarPlaneacion(supabase: SupabaseClient, soloProveedor?: string | null): Promise<DatosPlaneacion> {
  const hoy = hoyMx();
  const [{ data: provs, error: e1 }, { data: corteRow }] = await Promise.all([
    supabase.from("plan_proveedores").select("*").order("orden").order("nombre"),
    supabase.from("plan_cortes").select("id, fecha").order("fecha", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (e1) throw new Error(e1.message);
  const proveedores: PlanProveedor[] = (provs ?? []).map((p) => ({
    ...p,
    entrega_dias: Number(p.entrega_dias),
    tope_usd: num(p.tope_usd),
    contenedor_cbm: num(p.contenedor_cbm),
    base_meses: Number(p.base_meses),
    objetivo_meses: Number(p.objetivo_meses),
    punto_meses: Number(p.punto_meses),
    cobertura_meses: Number(p.cobertura_meses),
  }));
  const corte = (corteRow?.fecha as string | undefined) ?? null;

  type ArtRow = { clave: string; proveedor_id: string; nombre: string; um: string | null; empaque: string | null; cbm_empaque: string | null; precio: string | null; pedido_tipico?: string | null };
  const traerArts = (cols: string) =>
    todas<ArtRow>((a, b) => {
      let q = supabase.from("plan_articulos").select(cols).eq("activo", true).order("clave").range(a, b);
      if (soloProveedor) q = q.eq("proveedor_id", soloProveedor);
      return q as unknown as PromiseLike<{ data: ArtRow[] | null; error: { message: string } | null }>;
    });
  // Sin la actualizacion 0061 todavia no existe el pedido tipico.
  const arts = await traerArts("clave, proveedor_id, nombre, um, empaque, cbm_empaque, precio, pedido_tipico").catch(() => traerArts("clave, proveedor_id, nombre, um, empaque, cbm_empaque, precio"));
  const claves = new Set(arts.map((a) => a.clave));

  const exist = new Map<string, number>();
  if (corteRow?.id) {
    const ex = await todas<{ clave: string; existencia: string }>((a, b) => supabase.from("plan_existencias").select("clave, existencia").eq("corte_id", corteRow.id).range(a, b));
    for (const e of ex) exist.set(e.clave, Number(e.existencia));
  }
  type HistRow = { clave: string; mes: string; venta: string; traspasos: string; dias_stock: number; dias: number; existencia_fin: string | null; dias_suficiente?: number; venta_suficiente?: string; traspasos_suficiente?: string };
  const traerHist = (cols: string) =>
    todas<HistRow>((a, b) => supabase.from("plan_historial").select(cols).order("clave").order("mes").range(a, b) as unknown as PromiseLike<{ data: HistRow[] | null; error: { message: string } | null }>);
  const hist = await traerHist("clave, mes, venta, traspasos, dias_stock, dias, existencia_fin, dias_suficiente, venta_suficiente, traspasos_suficiente").catch(() =>
    traerHist("clave, mes, venta, traspasos, dias_stock, dias, existencia_fin"),
  );
  const histPor = new Map<string, MesHist[]>();
  for (const h of hist) {
    if (!claves.has(h.clave)) continue;
    const l = histPor.get(h.clave) ?? [];
    const conSuf = h.dias_suficiente != null && (h.dias_suficiente > 0 || Number(h.venta_suficiente ?? 0) > 0 || h.dias_stock === 0);
    l.push({
      mes: h.mes.slice(0, 7), venta: Number(h.venta), traspasos: Number(h.traspasos), dias_stock: h.dias_stock, dias: h.dias, existencia_fin: num(h.existencia_fin),
      ...(conSuf ? { dias_suf: h.dias_suficiente, venta_suf: Number(h.venta_suficiente ?? 0), tras_suf: Number(h.traspasos_suficiente ?? 0) } : {}),
    });
    histPor.set(h.clave, l);
  }

  // OCs y sus lineas
  type OcRow = { id: string; folio: string; proveedor_id: string; fecha: string; estado: EstadoOc; llegada_estimada: string | null; recibida_fecha: string | null; origen: "excel" | "portal" };
  const ocRows = await todas<OcRow>((a, b) => {
    let q = supabase.from("plan_ocs").select("id, folio, proveedor_id, fecha, estado, llegada_estimada, recibida_fecha, origen").order("fecha", { ascending: false }).range(a, b);
    if (soloProveedor) q = q.eq("proveedor_id", soloProveedor);
    return q;
  });
  const ocIds = ocRows.map((o) => o.id);
  type LinRow = { oc_id: string; clave: string; cantidad: string; cantidad_proforma: string | null; recibido: string; recibido_fecha: string | null; precio: string | null };
  const lineas: LinRow[] = [];
  for (let i = 0; i < ocIds.length; i += 200) {
    const parte = ocIds.slice(i, i + 200);
    lineas.push(...(await todas<LinRow>((a, b) => supabase.from("plan_oc_lineas").select("oc_id, clave, cantidad, cantidad_proforma, recibido, recibido_fecha, precio").in("oc_id", parte).range(a, b))));
  }
  const ocPor = new Map(ocRows.map((o) => [o.id, o]));
  const provPor = new Map(proveedores.map((p) => [p.id, p]));
  const llegadas = new Map<string, Llegada[]>();
  const recibidoPost = new Map<string, number>();
  const resumen = new Map<string, OcResumen>(ocRows.map((o) => [o.id, { ...o, lineas: 0, piezas: 0, importe: 0 }]));
  for (const l of lineas) {
    const oc = ocPor.get(l.oc_id)!;
    const r = resumen.get(l.oc_id)!;
    const pedido = l.cantidad_proforma != null ? Number(l.cantidad_proforma) : Number(l.cantidad);
    r.lineas += 1;
    r.piezas += pedido;
    r.importe += pedido * Number(l.precio ?? 0);
    const rec = Number(l.recibido);
    if (corte && rec > 0 && l.recibido_fecha && l.recibido_fecha > corte) recibidoPost.set(l.clave, (recibidoPost.get(l.clave) ?? 0) + rec);
    if (EN_CAMINO.includes(oc.estado)) {
      const falta = pedido - rec;
      if (falta > 0) {
        const p = provPor.get(oc.proveedor_id);
        const fecha = oc.llegada_estimada ?? addDias(oc.fecha, p?.entrega_dias ?? 30);
        const ls = llegadas.get(l.clave) ?? [];
        ls.push({ folio: oc.folio, oc_id: oc.id, estado: oc.estado, cantidad: falta, fecha });
        llegadas.set(l.clave, ls);
      }
    }
  }

  // Ventas registradas en el portal despues del corte (bitacora y venta con factura).
  const ventas = new Map<string, { fecha: string; cantidad: number }[]>();
  let ventasPortal = 0;
  if (corte) {
    type VRow = { cantidad: string | null; articulos: { clave: string } | null; ventas: { fecha: string; cancelada_at: string | null; tipo: string } | null };
    const vs = await todas<VRow>((a, b) =>
      supabase
        .from("venta_lineas")
        .select("cantidad, articulos(clave), ventas!inner(fecha, cancelada_at, tipo)")
        .gt("ventas.fecha", corte)
        .not("articulo_id", "is", null)
        .range(a, b) as unknown as PromiseLike<{ data: VRow[] | null; error: { message: string } | null }>,
    );
    for (const v of vs) {
      const clave = v.articulos?.clave;
      if (!clave || !v.ventas || v.ventas.cancelada_at || v.ventas.tipo !== "venta" || !v.cantidad) continue;
      ventasPortal += 1;
      const l = ventas.get(clave) ?? [];
      l.push({ fecha: v.ventas.fecha.slice(0, 10), cantidad: Number(v.cantidad) });
      ventas.set(clave, l);
    }
  }

  const articulos = arts.map((a) => {
    const vend = (ventas.get(a.clave) ?? []).reduce((s, v) => s + v.cantidad, 0);
    const existencia_corte = exist.get(a.clave) ?? 0;
    const recibido_post = recibidoPost.get(a.clave) ?? 0;
    const existencia = existencia_corte - vend + recibido_post;
    const h = histPor.get(a.clave) ?? [];
    return {
      clave: a.clave,
      proveedor_id: a.proveedor_id,
      nombre: a.nombre,
      um: a.um,
      empaque: num(a.empaque),
      cbm_empaque: num(a.cbm_empaque),
      precio: num(a.precio),
      pedido_tipico: num(a.pedido_tipico),
      existencia_corte,
      ventas_portal: vend,
      recibido_post,
      existencia,
      historial: corte ? historialConPortal(h, corte, hoy, ventas.get(a.clave) ?? [], existencia > 0) : h,
      llegadas: (llegadas.get(a.clave) ?? []).sort((x, y) => x.fecha.localeCompare(y.fecha)),
    };
  });

  return { corte, hoy, proveedores, articulos, ocs: [...resumen.values()], ventasPortal };
}
