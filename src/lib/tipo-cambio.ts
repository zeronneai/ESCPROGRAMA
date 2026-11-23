import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

/**
 * Tipos de cambio USD/MXN por dia.
 * - Con BANXICO_TOKEN (gratis en banxico.org.mx, SIE API): FIX oficial (serie SF43718).
 * - Sin token: tipo de cambio de referencia del Banco Central Europeo (frankfurter.dev), muy parecido.
 * La venta usa el del DOF de su fecha = FIX del dia habil anterior (ver tipo_cambio_para en la base).
 */
type Fila = { fecha: string; usd_mxn: number; fuente: "banxico" | "referencia" };

async function conTiempo(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: c.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

export async function bajarBanxico(desde: string, hasta: string, token: string): Promise<Fila[]> {
  const r = await conTiempo(`https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/${desde}/${hasta}`, { headers: { "Bmx-Token": token, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Banxico respondio ${r.status}`);
  const j = (await r.json()) as { bmx?: { series?: { datos?: { fecha: string; dato: string }[] }[] } };
  return (j.bmx?.series?.[0]?.datos ?? [])
    .map((d) => {
      const [dd, mm, yy] = d.fecha.split("/");
      return { fecha: `${yy}-${mm}-${dd}`, usd_mxn: Number(d.dato.replace(/,/g, "")), fuente: "banxico" as const };
    })
    .filter((f) => Number.isFinite(f.usd_mxn) && f.usd_mxn >= 5 && f.usd_mxn <= 60);
}

export async function bajarReferencia(desde: string, hasta: string): Promise<Fila[]> {
  const r = await conTiempo(`https://api.frankfurter.dev/v1/${desde}..${hasta}?base=USD&symbols=MXN`);
  if (!r.ok) throw new Error(`frankfurter respondio ${r.status}`);
  const j = (await r.json()) as { rates?: Record<string, { MXN?: number }> };
  return Object.entries(j.rates ?? {})
    .map(([fecha, v]) => ({ fecha, usd_mxn: Number(v.MXN), fuente: "referencia" as const }))
    .filter((f) => Number.isFinite(f.usd_mxn) && f.usd_mxn >= 5 && f.usd_mxn <= 60);
}

/**
 * Baja los tipos de cambio que falten (desde la venta en USD mas vieja sin tipo de cambio, o la ultima
 * semana) y llena las ventas en USD. Usa el cliente de servicio. Nunca truena: regresa lo que paso.
 */
export async function asegurarTiposCambio(admin: SupabaseClient, zona = "America/Chihuahua"): Promise<{ bajados: number; ventas: number; fuente: string | null; error?: string }> {
  try {
    const hoy = DateTime.now().setZone(zona);
    const { data: pend } = await admin.rpc("tipo_cambio_pendiente_desde");
    const base = pend ? DateTime.fromISO(String(pend)) : hoy.minus({ days: 7 });
    const desde = DateTime.min(base, hoy.minus({ days: 7 })).minus({ days: 10 }).toISODate()!;
    const hasta = hoy.toISODate()!;
    const token = process.env.BANXICO_TOKEN?.trim();
    let filas: Fila[] = [];
    let fuente: string | null = null;
    if (token) {
      try {
        filas = await bajarBanxico(desde, hasta, token);
        fuente = "banxico";
      } catch {
        filas = [];
      }
    }
    if (!filas.length) {
      filas = await bajarReferencia(desde, hasta);
      fuente = "referencia";
    }
    if (filas.length) {
      // El FIX de Banxico manda sobre el de referencia.
      const { data: ya } = await admin.from("tipos_cambio").select("fecha, fuente").gte("fecha", desde);
      const oficial = new Set((ya ?? []).filter((x) => x.fuente === "banxico").map((x) => x.fecha as string));
      const subir = filas.filter((f) => f.fuente === "banxico" || !oficial.has(f.fecha));
      if (subir.length) {
        const { error } = await admin.from("tipos_cambio").upsert(subir, { onConflict: "fecha" });
        if (error) throw new Error(error.message);
      }
    }
    const { data: n, error: e2 } = await admin.rpc("ventas_rellenar_tipo_cambio");
    if (e2) throw new Error(e2.message);
    return { bajados: filas.length, ventas: Number(n ?? 0), fuente };
  } catch (e) {
    return { bajados: 0, ventas: 0, fuente: null, error: e instanceof Error ? e.message : String(e) };
  }
}
