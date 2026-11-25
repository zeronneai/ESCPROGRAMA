import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcular, ESTADOS_OC, PARAMETROS_BASE, redondeaEmpaque, type Parametros } from "./planeacion";
import { FRECUENCIA_CORTA } from "./pedidos";
import type { DatosPlaneacion } from "./planeacion-server";

/**
 * Asistente de compras (Claude): herramientas que leen la planeacion del comprador y una para proponer OCs.
 * Nunca crea nada por su cuenta: la propuesta se muestra al comprador y el la genera con un boton.
 */

export const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
/** Precio aproximado por millon de tokens (entrada, salida) para mostrar el gasto. */
export const PRECIO_MTOK: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-haiku-5-5": [0.1, 0.5],
};

export interface LineaPropuesta {
  clave: string;
  nombre: string;
  cantidad: number;
  precio: number | null;
  importe: number;
  cbm: number;
}
export interface OcPropuesta {
  proveedor_id: string;
  proveedor: string;
  fecha: string;
  nota: string;
  lineas: LineaPropuesta[];
  importe: number;
  cbm: number;
  tope: number | null;
}
export interface Propuesta {
  resumen: string;
  ocs: OcPropuesta[];
}

const r1 = (n: number, d = 1) => (isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

export const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: "resumen_general",
    description:
      "Panorama de la planeación: fecha de hoy y del corte de existencias, cada proveedor con su configuración (origen, días de entrega, tope por OC en USD, contenedor CBM, meses de base/objetivo o punto/cobertura), cuántos artículos están en rojo (se acaban antes de que llegue un pedido) o amarillo (ya toca pedir), lo sugerido para pedir hoy en USD, y cuántas OCs abiertas y pedidos de vendedores hay. Úsala primero.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "articulos_proveedor",
    description:
      "Artículos de un proveedor con existencia, en camino, venta real por mes (sin contar días sin stock), demanda para planear, meses de inventario, semáforo, cantidad sugerida a pedir hoy (ya redondeada a cajas), precio USD, empaque, CBM por caja, fecha en que se acaba y pedidos de vendedores. Puedes cambiar la ventana de meses y el % de crecimiento para ajustar a cómo se está moviendo la venta.",
    input_schema: {
      type: "object",
      properties: {
        proveedor: { type: "string", description: "Nombre (o parte) o id del proveedor" },
        filtro: { type: "string", enum: ["por_pedir", "con_venta", "todos"], description: "por_pedir = solo rojo/amarillo o con sugerido > 0 (default); con_venta = con demanda; todos" },
        ventana_meses: { type: "number", description: "Meses de historia para la venta real (6, 12 o 24). Default 12." },
        crecimiento_pct: { type: "number", description: "Crecimiento sobre la venta real, en %. Default 16." },
      },
      required: ["proveedor"],
    },
  },
  {
    name: "buscar_articulo",
    description: "Busca artículos por clave o texto en el nombre (en todos los proveedores) y regresa sus datos de planeación.",
    input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
  {
    name: "historial_articulo",
    description: "Venta mes a mes de un artículo (kárdex más lo vendido en el portal después del corte), días con existencia y existencia al cierre. Sirve para ver si la venta sube o baja.",
    input_schema: { type: "object", properties: { clave: { type: "string" } }, required: ["clave"] },
  },
  {
    name: "tendencia_proveedor",
    description: "Venta total mes a mes de los artículos de un proveedor (piezas y USD a precio de lista) en los últimos 12 meses, para ver si el movimiento sube o baja.",
    input_schema: { type: "object", properties: { proveedor: { type: "string" } }, required: ["proveedor"] },
  },
  {
    name: "ocs",
    description: "Lista de órdenes de compra con folio, proveedor, fecha, estado, llegada estimada, artículos, piezas e importe USD. Por default solo las abiertas (borrador, enviada, con proforma, embarcada).",
    input_schema: {
      type: "object",
      properties: {
        estado: { type: "string", enum: ["abiertas", "todas", "borrador", "enviada", "proforma", "embarcada", "recibida", "cancelada"] },
        proveedor: { type: "string" },
        desde: { type: "string", description: "Fecha YYYY-MM-DD mínima de la OC" },
      },
    },
  },
  {
    name: "detalle_oc",
    description: "Renglones de una OC por folio: clave, cantidad pedida, de proforma, recibida y precio.",
    input_schema: { type: "object", properties: { folio: { type: "string" } }, required: ["folio"] },
  },
  {
    name: "pedidos_vendedores",
    description: "Pedidos activos que los vendedores le hicieron al comprador (del kárdex y 'otro'), con cantidad, frecuencia (única, semanal, mensual, anual), cliente y quién lo pidió.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "guardar_reglas",
    description:
      "Guarda las reglas de compra que el comprador te pide recordar (ej. 'tope de 25,000 USD por OC con TopGlove', 'pedir a americanos cada 2 semanas'). Manda el texto COMPLETO de las reglas (las anteriores que sigan vigentes más los cambios), en viñetas cortas. Úsala solo cuando el comprador diga que lo recuerdes o que una regla cambió.",
    input_schema: { type: "object", properties: { reglas: { type: "string" } }, required: ["reglas"] },
  },
  {
    name: "proponer_ocs",
    description:
      "Propón un plan de una o varias OCs. NO las crea: el comprador las revisa y las genera con un botón. Cada OC es de un solo proveedor, con fecha sugerida para emitirla y renglones (clave y cantidad; la cantidad se redondea a cajas completas). Regresa el importe USD y CBM de cada OC y avisa si pasa el tope. Puedes llamarla otra vez para corregir.",
    input_schema: {
      type: "object",
      properties: {
        resumen: { type: "string", description: "Una o dos frases: qué criterio usaste" },
        ocs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              proveedor: { type: "string" },
              fecha: { type: "string", description: "YYYY-MM-DD en que se emitiría" },
              nota: { type: "string" },
              lineas: { type: "array", items: { type: "object", properties: { clave: { type: "string" }, cantidad: { type: "number" } }, required: ["clave", "cantidad"] } },
            },
            required: ["proveedor", "fecha", "lineas"],
          },
        },
      },
      required: ["resumen", "ocs"],
    },
  },
];

export function sistema(datos: DatosPlaneacion, reglas: string): string {
  return [
    "Eres el asistente de compras de ESC Representaciones (distribuidora industrial en Cd. Juárez). Hablas con el comprador, en español de México, claro y directo. No uses guiones largos.",
    `Hoy es ${datos.hoy}. La existencia viene del kárdex de Microsip al ${datos.corte ?? "(sin corte)"}, menos lo vendido en el portal desde entonces, más lo recibido de OCs.`,
    "Cómo se planea: venta real = vendido / días con existencia suficiente x 30.4 (el desabasto no esconde venta). Demanda para planear = venta real x (1 + crecimiento, 16% por default) + pedidos recurrentes de vendedores. Posición = existencia + en camino - comprometido (Pegatron y pedidos especiales de vendedores).",
    "Americanos (usa): se pide cuando la posición no alcanza para entrega + base meses; se pide hasta entrega + objetivo meses; tienen tope por OC en USD (si pasa, se parte en varias OCs, lo más urgente primero) y se revisan cada 2 semanas. Asiáticos (china): se pide al bajar de 'punto' meses hasta 'cobertura' meses; la orden llega completa en contenedor (CBM).",
    "Las OCs en borrador ya cuentan como en camino. Los precios están en USD. Las cantidades van en múltiplos del empaque (cajas completas).",
    "Usa las herramientas para consultar datos reales; nunca inventes cifras. Cuando te pidan un plan de OCs, usa proponer_ocs (puedes repartir en varias fechas, por ejemplo cada 2 semanas, respetando el tope) y explica en pocas líneas qué propones y por qué. Si te dicen que una regla cambió o que recuerdes algo, guárdalo con guardar_reglas.",
    "Responde corto: listas o tablas en markdown cuando ayuden. Montos con $ y separador de miles.",
    reglas.trim() ? `REGLAS VIGENTES DEL COMPRADOR (síguelas salvo que te diga otra cosa):\n${reglas.trim()}` : "El comprador todavía no ha guardado reglas propias.",
  ].join("\n\n");
}

type Ctx = { datos: DatosPlaneacion; supabase: SupabaseClient; propuesta: Propuesta | null; reglas: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function buscarProv(ctx: Ctx, q: string) {
  const n = norm(q);
  return ctx.datos.proveedores.find((p) => p.id === q) ?? ctx.datos.proveedores.find((p) => norm(p.nombre) === n) ?? ctx.datos.proveedores.find((p) => norm(p.nombre).includes(n) || (p.codigo && norm(p.codigo) === n));
}

function filaArt(ctx: Ctx, a: DatosPlaneacion["articulos"][number], p: Parametros) {
  const prov = ctx.datos.proveedores.find((x) => x.id === a.proveedor_id)!;
  const c = calcular(a, prov, p, ctx.datos.hoy);
  return {
    clave: a.clave,
    nombre: a.nombre.slice(0, 70),
    proveedor: prov.nombre,
    um: a.um,
    existencia: r1(a.existencia, 0),
    en_camino: r1(c.transito, 0),
    venta_real_mes: r1(c.real),
    demanda_mes: r1(c.plan),
    meses_inv: r1(c.mesesInv),
    meses_posicion: r1(c.mesesPos),
    semaforo: c.semaforo,
    sugerido: c.sugerido,
    empaque: a.empaque,
    precio_usd: a.precio,
    cbm_caja: a.cbm_empaque,
    se_acaba: c.agota,
    ...(a.pegatron?.cantidad ? { pegatron_comprometido: a.pegatron.cantidad } : {}),
    ...(a.pedidos ? { pedidos_vendedores: { unica: a.pedidos.unica, extra_mes: r1(a.pedidos.mensual) } } : {}),
  };
}

function params(input: { ventana_meses?: number; crecimiento_pct?: number }): Parametros {
  return {
    ...PARAMETROS_BASE,
    ventana: input.ventana_meses && input.ventana_meses > 0 ? Math.min(36, Math.round(input.ventana_meses)) : PARAMETROS_BASE.ventana,
    crecimiento: input.crecimiento_pct != null && isFinite(input.crecimiento_pct) ? Math.max(-50, Math.min(200, input.crecimiento_pct)) / 100 : PARAMETROS_BASE.crecimiento,
  };
}

/** Ejecuta una herramienta y regresa el resultado (se manda como JSON al modelo). */
export async function ejecutar(nombre: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const d = ctx.datos;
  switch (nombre) {
    case "resumen_general": {
      const provs = d.proveedores.map((p) => {
        const arts = d.articulos.filter((a) => a.proveedor_id === p.id);
        let rojo = 0, amarillo = 0, usd = 0, cbm = 0;
        for (const a of arts) {
          const c = calcular(a, p, PARAMETROS_BASE, d.hoy);
          if (c.semaforo === "rojo") rojo++;
          if (c.semaforo === "amarillo") amarillo++;
          usd += c.importe;
          cbm += c.cbm;
        }
        const abiertas = d.ocs.filter((o) => o.proveedor_id === p.id && o.estado !== "recibida" && o.estado !== "cancelada");
        return {
          id: p.id, nombre: p.nombre, siglas: p.codigo, origen: p.origen, entrega_dias: p.entrega_dias, tope_usd: p.tope_usd, contenedor_cbm: p.contenedor_cbm,
          ...(p.origen === "usa" ? { base_meses: p.base_meses, objetivo_meses: p.objetivo_meses } : { punto_meses: p.punto_meses, cobertura_meses: p.cobertura_meses }),
          articulos: arts.length, rojo, amarillo, sugerido_hoy_usd: Math.round(usd), sugerido_hoy_cbm: r1(cbm, 2),
          ocs_abiertas: abiertas.length, en_camino_usd: Math.round(abiertas.reduce((s, o) => s + o.importe, 0)),
        };
      });
      const pedidos = d.articulos.reduce((n, a) => n + (a.pedidos?.lista.length ?? 0), 0) + d.pedidosOtros.length;
      return { hoy: d.hoy, corte: d.corte, proveedores: provs, pedidos_vendedores_activos: pedidos };
    }
    case "articulos_proveedor": {
      const prov = buscarProv(ctx, String(input.proveedor ?? ""));
      if (!prov) return { error: `No encontré el proveedor "${input.proveedor}". Proveedores: ${d.proveedores.map((p) => p.nombre).join(", ")}` };
      const p = params(input as { ventana_meses?: number; crecimiento_pct?: number });
      const filtro = (input.filtro as string) ?? "por_pedir";
      const filas = d.articulos
        .filter((a) => a.proveedor_id === prov.id)
        .map((a) => filaArt(ctx, a, p))
        .filter((f) => (filtro === "todos" ? true : filtro === "con_venta" ? (f.demanda_mes ?? 0) > 0 : f.semaforo === "rojo" || f.semaforo === "amarillo" || f.sugerido > 0))
        .sort((x, y) => (x.meses_posicion ?? 999) - (y.meses_posicion ?? 999));
      return { proveedor: prov.nombre, origen: prov.origen, entrega_dias: prov.entrega_dias, tope_usd: prov.tope_usd, contenedor_cbm: prov.contenedor_cbm, total: filas.length, articulos: filas.slice(0, 200), ...(filas.length > 200 ? { nota: "Solo los 200 más urgentes" } : {}) };
    }
    case "buscar_articulo": {
      const t = norm(String(input.texto ?? ""));
      if (t.length < 2) return { error: "Texto muy corto" };
      const palabras = t.split(/\s+/);
      const hits = d.articulos.filter((a) => {
        const s = norm(`${a.clave} ${a.nombre}`);
        return palabras.every((w) => s.includes(w));
      });
      return { total: hits.length, articulos: hits.slice(0, 40).map((a) => filaArt(ctx, a, PARAMETROS_BASE)) };
    }
    case "historial_articulo": {
      const a = d.articulos.find((x) => norm(x.clave) === norm(String(input.clave ?? "")));
      if (!a) return { error: "No encontré esa clave" };
      return {
        clave: a.clave, nombre: a.nombre, existencia: a.existencia, vendido_portal_desde_corte: a.ventas_portal,
        meses: a.historial.slice(-24).map((m) => ({ mes: m.mes, venta: m.venta, traspasos: m.traspasos, dias_con_existencia: m.dias_stock, dias: m.dias, existencia_cierre: m.existencia_fin })),
        llegadas: a.llegadas,
      };
    }
    case "tendencia_proveedor": {
      const prov = buscarProv(ctx, String(input.proveedor ?? ""));
      if (!prov) return { error: "No encontré el proveedor" };
      const meses = new Map<string, { piezas: number; usd: number }>();
      for (const a of d.articulos.filter((x) => x.proveedor_id === prov.id)) {
        for (const m of a.historial.slice(-12)) {
          const v = m.venta + m.traspasos;
          const t = meses.get(m.mes) ?? { piezas: 0, usd: 0 };
          t.piezas += v;
          t.usd += v * (a.precio ?? 0);
          meses.set(m.mes, t);
        }
      }
      return { proveedor: prov.nombre, meses: [...meses.entries()].sort().map(([mes, t]) => ({ mes, piezas: Math.round(t.piezas), usd: Math.round(t.usd) })) };
    }
    case "ocs": {
      const est = (input.estado as string) ?? "abiertas";
      const prov = input.proveedor ? buscarProv(ctx, String(input.proveedor)) : null;
      if (input.proveedor && !prov) return { error: "No encontré el proveedor" };
      const lista = d.ocs
        .filter((o) => (est === "todas" ? true : est === "abiertas" ? o.estado !== "recibida" && o.estado !== "cancelada" : o.estado === est))
        .filter((o) => !prov || o.proveedor_id === prov.id)
        .filter((o) => !input.desde || o.fecha >= String(input.desde))
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
      return {
        total: lista.length,
        importe_total_usd: Math.round(lista.reduce((s, o) => s + o.importe, 0)),
        ocs: lista.slice(0, 120).map((o) => ({
          folio: o.folio, proveedor: d.proveedores.find((p) => p.id === o.proveedor_id)?.nombre, fecha: o.fecha, estado: ESTADOS_OC[o.estado],
          llegada_estimada: o.llegada_estimada, recibida: o.recibida_fecha, articulos: o.lineas, piezas: Math.round(o.piezas), importe_usd: Math.round(o.importe),
          ...(o.estado !== "recibida" && o.estado !== "cancelada" && o.llegada_estimada && o.llegada_estimada < d.hoy ? { atrasada: true } : {}),
        })),
      };
    }
    case "detalle_oc": {
      const oc = d.ocs.find((o) => norm(o.folio) === norm(String(input.folio ?? "")));
      if (!oc) return { error: "No encontré ese folio" };
      const { data } = await ctx.supabase.from("plan_oc_lineas").select("clave, cantidad, cantidad_proforma, recibido, recibido_fecha, precio").eq("oc_id", oc.id).order("clave");
      return { folio: oc.folio, estado: ESTADOS_OC[oc.estado], fecha: oc.fecha, llegada_estimada: oc.llegada_estimada, lineas: data ?? [] };
    }
    case "pedidos_vendedores": {
      const kardex = d.articulos.flatMap((a) =>
        (a.pedidos?.lista ?? []).map((x) => ({ clave: a.clave, nombre: a.nombre.slice(0, 60), proveedor: d.proveedores.find((p) => p.id === a.proveedor_id)?.nombre, cantidad: x.cantidad, frecuencia: FRECUENCIA_CORTA[x.frecuencia], cliente: x.cliente, vendedor: x.vendedor, desde: x.created_at.slice(0, 10), notas: x.notas })),
      );
      const otros = d.pedidosOtros.map((x) => ({ clave: x.clave, descripcion: x.descripcion, cantidad: x.cantidad, um: x.um, frecuencia: FRECUENCIA_CORTA[x.frecuencia], cliente: x.cliente, vendedor: x.vendedor, desde: x.created_at.slice(0, 10), notas: x.notas }));
      return { del_kardex: kardex, fuera_del_kardex: otros };
    }
    case "guardar_reglas": {
      const reglas = String(input.reglas ?? "").slice(0, 8000);
      const { error } = await ctx.supabase.from("plan_asistente").upsert({ id: 1, reglas });
      if (error) return { error: error.message };
      ctx.reglas = reglas;
      return { ok: true };
    }
    case "proponer_ocs": {
      const avisos: string[] = [];
      const ocs: OcPropuesta[] = [];
      for (const o of (input.ocs as { proveedor: string; fecha: string; nota?: string; lineas: { clave: string; cantidad: number }[] }[]) ?? []) {
        const prov = buscarProv(ctx, String(o.proveedor ?? ""));
        if (!prov) {
          avisos.push(`Proveedor "${o.proveedor}" no existe; se omitió esa OC.`);
          continue;
        }
        const lineas: LineaPropuesta[] = [];
        for (const l of o.lineas ?? []) {
          const a = d.articulos.find((x) => norm(x.clave) === norm(String(l.clave)));
          if (!a) {
            avisos.push(`${l.clave}: no existe en la planeación.`);
            continue;
          }
          if (a.proveedor_id !== prov.id) {
            avisos.push(`${a.clave} es de otro proveedor; se omitió de la OC de ${prov.nombre}.`);
            continue;
          }
          const cant = redondeaEmpaque(Number(l.cantidad) || 0, a.empaque);
          if (cant <= 0) continue;
          const prev = lineas.find((x) => x.clave === a.clave);
          const cbm = a.empaque && a.cbm_empaque ? (cant / a.empaque) * a.cbm_empaque : 0;
          if (prev) {
            prev.cantidad += cant;
            prev.importe += cant * (a.precio ?? 0);
            prev.cbm += cbm;
          } else lineas.push({ clave: a.clave, nombre: a.nombre, cantidad: cant, precio: a.precio, importe: cant * (a.precio ?? 0), cbm });
        }
        if (!lineas.length) continue;
        const importe = lineas.reduce((s, l) => s + l.importe, 0);
        const cbm = lineas.reduce((s, l) => s + l.cbm, 0);
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(o.fecha)) ? String(o.fecha) : d.hoy;
        if (prov.tope_usd && importe > prov.tope_usd * 1.001) avisos.push(`OC de ${prov.nombre} del ${fecha}: $${Math.round(importe).toLocaleString("en-US")} pasa el tope de $${prov.tope_usd.toLocaleString("en-US")}.`);
        if (prov.contenedor_cbm && cbm > prov.contenedor_cbm) avisos.push(`OC de ${prov.nombre} del ${fecha}: ${cbm.toFixed(1)} CBM no cabe en el contenedor de ${prov.contenedor_cbm}.`);
        if (!prov.codigo) avisos.push(`${prov.nombre} no tiene siglas para el folio: el comprador debe ponerlas en Ajustes antes de generar.`);
        ocs.push({ proveedor_id: prov.id, proveedor: prov.nombre, fecha, nota: String(o.nota ?? "").slice(0, 500), lineas, importe, cbm, tope: prov.tope_usd });
      }
      ocs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.proveedor.localeCompare(b.proveedor));
      ctx.propuesta = { resumen: String(input.resumen ?? "").slice(0, 1000), ocs };
      return {
        ok: ocs.length > 0,
        ocs: ocs.map((o) => ({ proveedor: o.proveedor, fecha: o.fecha, renglones: o.lineas.length, importe_usd: Math.round(o.importe), cbm: r1(o.cbm, 2), tope_usd: o.tope })),
        avisos,
        nota: "La propuesta ya se le muestra al comprador con botones para generar cada OC en borrador. Si hay avisos, corrige llamando otra vez.",
      };
    }
  }
  return { error: `Herramienta desconocida: ${nombre}` };
}

