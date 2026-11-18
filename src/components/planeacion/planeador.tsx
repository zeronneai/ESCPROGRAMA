"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { ajustesProveedorAction, crearOcAction } from "@/actions/planeacion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import {
  calcular,
  fechaCortaMx,
  fmtNum,
  PARAMETROS_BASE,
  rellenarContenedor,
  SEMAFORO,
  type ArticuloPlan,
  type Calculo,
  type Parametros,
  type PlanProveedor,
  type Semaforo,
} from "@/lib/planeacion";
import { GraficaArticulo } from "./grafica";

const PILL: Record<Semaforo, string> = {
  rojo: "bg-red-100 text-red-800",
  amarillo: "bg-amber-100 text-amber-800",
  verde: "bg-green-100 text-green-800",
  gris: "bg-slate-100 text-slate-600",
};
const ORDEN: Record<Semaforo, number> = { rojo: 0, amarillo: 1, verde: 2, gris: 3 };

export function Planeador({ prov, articulos, hoy }: { prov: PlanProveedor; articulos: ArticuloPlan[]; hoy: string }) {
  const router = useRouter();
  const [p, setP] = useState<Parametros>(PARAMETROS_BASE);
  const [relleno, setRelleno] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [pend, start] = useTransition();
  const china = prov.origen === "china";

  const extra = useMemo(() => (relleno && china ? rellenarContenedor(articulos, prov, p, hoy) : {}), [relleno, china, articulos, prov, p, hoy]);
  const filas = useMemo(() => {
    const r = articulos.map((a) => {
      const c = calcular(a, prov, p, hoy, extra[a.clave] ?? 0);
      const pedir = manual[a.clave] ?? c.sugerido;
      return { a, c, pedir };
    });
    return r.sort((x, y) => ORDEN[x.c.semaforo] - ORDEN[y.c.semaforo] || x.c.mesesInv - y.c.mesesInv);
  }, [articulos, prov, p, hoy, extra, manual]);

  const cbmDe = (a: ArticuloPlan, q: number) => (a.empaque && a.cbm_empaque ? (q / a.empaque) * a.cbm_empaque : 0);
  const totCbm = filas.reduce((s, f) => s + cbmDe(f.a, f.pedir), 0);
  const totUsd = filas.reduce((s, f) => s + f.pedir * (f.a.precio ?? 0), 0);
  const nPedir = filas.filter((f) => f.pedir > 0).length;
  const cuenta = (s: Semaforo) => filas.filter((f) => f.c.semaforo === s).length;
  const tope = prov.tope_usd ?? 0;
  const nOcs = !china && tope && totUsd > tope ? Math.ceil(totUsd / tope) : 1;

  function generar() {
    const lineas = filas.filter((f) => f.pedir > 0).map((f) => ({ clave: f.a.clave, cantidad: f.pedir, precio: f.a.precio }));
    if (!lineas.length) return toast("No hay nada que pedir. Escribe una cantidad en la columna Pedir.", "error");
    // Americanos: si pasa el tope se parte en varias OCs (lo mas urgente primero).
    const grupos: typeof lineas[] = [];
    if (nOcs > 1) {
      let g: typeof lineas = [];
      let suma = 0;
      for (const l of lineas) {
        const imp = l.cantidad * (l.precio ?? 0);
        if (g.length && suma + imp > tope) {
          grupos.push(g);
          g = [];
          suma = 0;
        }
        g.push(l);
        suma += imp;
      }
      if (g.length) grupos.push(g);
    } else grupos.push(lineas);
    start(async () => {
      const creadas: { id: string; folio: string }[] = [];
      for (const g of grupos) {
        const r = await crearOcAction(prov.id, g);
        if (!r.ok) return toast(r.error, "error");
        creadas.push({ id: r.id, folio: r.folio });
      }
      toast(creadas.length > 1 ? `Listo: ${creadas.map((c) => c.folio).join(", ")} en borrador.` : `OC ${creadas[0].folio} creada en borrador.`, "success");
      setManual({});
      router.push(`/comprador/planeacion/oc/${creadas[0].id}`);
    });
  }

  const num = (v: string, d: number) => (v === "" || isNaN(Number(v)) ? d : Number(v));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Ventana de venta
          <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={p.ventana} onChange={(e) => setP({ ...p, ventana: Number(e.target.value) })}>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
            <option value={24}>Todo</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Crecimiento %
          <input type="number" min={0} max={100} className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={Math.round(p.crecimiento * 100)} onChange={(e) => setP({ ...p, crecimiento: num(e.target.value, 0) / 100 })} />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={p.traspasos} onChange={(e) => setP({ ...p, traspasos: e.target.checked })} />
          Contar traspasos como venta
        </label>
        <p className="ml-auto max-w-md text-xs text-slate-500">
          {china
            ? `China: pedir al bajar de ${fmtNum(prov.punto_meses, 1)} meses, hasta ${fmtNum(prov.cobertura_meses, 1)} meses. Entrega ${prov.entrega_dias} días. La orden llega completa.`
            : `Americano: base ${fmtNum(prov.base_meses, 1)} meses, objetivo ${fmtNum(prov.objetivo_meses, 1)} meses más la entrega (${prov.entrega_dias} días). Revisar cada 2 semanas.${prov.recibe_parcial ? " Puede llegar por partes." : ""}`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [cuenta("rojo"), "Se acaban antes de que llegue un pedido", "text-red-700"],
          [cuenta("amarillo"), "Ya toca pedir", "text-amber-700"],
          [nPedir, "Artículos a pedir", "text-slate-900"],
          [china ? `${fmtNum(totCbm, 1)} CBM` : `$${fmtNum(totUsd)}`, china ? "Volumen" : "Importe (USD)", "text-slate-900"],
          [china ? `$${fmtNum(totUsd)}` : nOcs > 1 ? `${nOcs} OCs` : "1 OC", china ? "Importe (USD)" : tope ? `Tope $${fmtNum(tope)} por OC` : "OC", "text-slate-900"],
        ].map(([a, b, cls], i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className={`text-xl font-semibold tabular-nums ${cls}`}>{a}</p>
            <p className="text-xs text-slate-500">{b}</p>
          </div>
        ))}
      </div>

      {china && prov.contenedor_cbm ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Contenedor: {fmtNum(totCbm, 1)} de {fmtNum(prov.contenedor_cbm)} CBM ({fmtNum(Math.min(100, (totCbm / prov.contenedor_cbm) * 100))}%)</p>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-600" style={{ width: `${Math.min(100, (totCbm / prov.contenedor_cbm) * 100)}%` }} /></div>
            <p className="mt-1 text-xs text-slate-500">{relleno ? "Agregué cajas a lo que se acaba primero hasta llenar el contenedor." : "Solo lo necesario. Usa el botón para mandar el contenedor lleno."}</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => { setManual({}); setRelleno(!relleno); }}>{relleno ? "Quitar relleno" : "Llenar contenedor"}</Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Artículo</th>
              <th className="px-3 py-2 text-right">Existencia</th>
              <th className="px-3 py-2 text-right">En camino</th>
              <th className="px-3 py-2 text-right">Prom. simple</th>
              <th className="px-3 py-2 text-right">Venta real</th>
              <th className="px-3 py-2 text-right">Sin stock</th>
              <th className="px-3 py-2 text-right">Meses inv.</th>
              <th className="px-3 py-2 text-right">Pedir</th>
              <th className="px-3 py-2 text-right">{china ? "CBM" : "Importe"}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ a, c, pedir }) => {
              const dif = c.simple > 0 ? c.real / c.simple - 1 : 0;
              const ab = abierto === a.clave;
              return (
                <Fragment key={a.clave}>
                  <tr className={`cursor-pointer border-t border-slate-100 hover:bg-brand-50/60 ${ab ? "bg-brand-50/60" : ""}`} onClick={() => setAbierto(ab ? null : a.clave)}>
                    <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[c.semaforo]}`}>{SEMAFORO[c.semaforo]}</span></td>
                    <td className="max-w-[280px] px-3 py-2">
                      <p className="font-medium">{a.clave}</p>
                      <p className="line-clamp-2 text-xs text-slate-500">{a.nombre}</p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {fmtNum(a.existencia)}
                      {a.ventas_portal > 0 && <span className="block text-[11px] text-slate-500">−{fmtNum(a.ventas_portal)} vendido</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{c.transito ? fmtNum(c.transito) : ""}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.simple, 1)}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {fmtNum(c.real, 1)}
                      {dif > 0.05 && <span className={`block text-[11px] font-normal ${dif > 0.15 ? "text-red-700" : "text-slate-500"}`}>+{fmtNum(dif * 100)}%</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.sinStock * 100)}%</td>
                    <td className="px-3 py-2 text-right">{isFinite(c.mesesInv) ? fmtNum(c.mesesInv, 1) : ""}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        min={0}
                        step={a.empaque && a.empaque > 1 ? a.empaque : 1}
                        aria-label={`Cantidad a pedir de ${a.clave}`}
                        className={`w-24 rounded-md border px-2 py-1 text-right text-sm ${pedir ? "border-brand-300 font-semibold text-brand-800" : "border-slate-200"}`}
                        value={pedir || ""}
                        placeholder="0"
                        onChange={(e) => setManual({ ...manual, [a.clave]: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      {pedir > 0 && a.empaque && a.empaque > 1 && <span className="block text-[11px] text-slate-500">{fmtNum(pedir / a.empaque, 1)} cajas</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{china ? (cbmDe(a, pedir) ? fmtNum(cbmDe(a, pedir), 2) : "") : pedir && a.precio ? `$${fmtNum(pedir * a.precio)}` : ""}</td>
                  </tr>
                  {ab && (
                    <tr className="border-t border-slate-100 bg-slate-50/70">
                      <td colSpan={10} className="px-3 py-3">
                        <Detalle a={a} c={c} prov={prov} p={p} hoy={hoy} pedir={pedir} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!filas.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">Este proveedor no tiene artículos cargados.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
        <p className="max-w-2xl text-sm text-brand-900">
          {nPedir ? `Se va a generar ${nOcs > 1 ? `${nOcs} OCs en borrador (tope de $${fmtNum(tope)} cada una)` : "una OC en borrador"} con ${nPedir} artículos. Ya en borrador cuenta como "en camino" y la puedes ajustar cuando llegue la proforma.` : "Ajusta las cantidades en la columna Pedir y genera la OC."}
        </p>
        <Button type="button" onClick={generar} loading={pend} disabled={!nPedir}>Generar OC</Button>
      </div>

      <AjustesProveedor prov={prov} />
    </div>
  );
}

function Detalle({ a, c, prov, p, hoy, pedir }: { a: ArticuloPlan; c: Calculo; prov: PlanProveedor; p: Parametros; hoy: string; pedir: number }) {
  const fila = (k: string, v: string) => (
    <div className="flex justify-between gap-3 border-b border-dashed border-slate-200 py-1"><span className="text-slate-600">{k}</span><b className="tabular-nums">{v}</b></div>
  );
  const um = a.um ? ` ${a.um.toLowerCase()}` : "";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <GraficaArticulo a={a} c={c} prov={prov} p={p} hoy={hoy} pedir={pedir} />
      <div className="text-sm">
        {fila("Existencia Microsip al corte", fmtNum(a.existencia_corte) + um)}
        {a.ventas_portal > 0 && fila("Vendido en el portal desde el corte", `−${fmtNum(a.ventas_portal)}`)}
        {a.recibido_post > 0 && fila("Recibido de OCs desde el corte", `+${fmtNum(a.recibido_post)}`)}
        {fila("Existencia para planear", fmtNum(a.existencia))}
        {fila("En camino", fmtNum(c.transito))}
        {a.llegadas.map((l) => (
          <div key={l.oc_id} className="flex justify-between gap-3 py-0.5 pl-3 text-xs text-slate-500">
            <a href={`/comprador/planeacion/oc/${l.oc_id}`} className="text-brand-700 underline" onClick={(e) => e.stopPropagation()}>{l.folio}</a>
            <span>{fmtNum(l.cantidad)} · llega {fechaCortaMx(l.fecha)}{l.fecha < hoy ? " (ya debió llegar)" : ""}</span>
          </div>
        ))}
        {fila(`Promedio simple (${p.ventana} m)`, `${fmtNum(c.simple, 1)}/mes`)}
        {fila("Venta real (solo días con stock)", `${fmtNum(c.real, 1)}/mes`)}
        {fila(`Demanda para planear (+${fmtNum(p.crecimiento * 100)}%)`, `${fmtNum(c.plan, 1)}/mes`)}
        {fila("Punto de pedido", fmtNum(c.reorden))}
        {fila("Objetivo", fmtNum(c.objetivo))}
        {a.empaque && a.empaque > 1 ? fila("Empaque", `${fmtNum(a.empaque)} por caja`) : null}
        {fila("Se acaba aprox.", c.agota ? fechaCortaMx(c.agota) : "No en 2 años")}
        {fila("Si pides hoy llega aprox.", fechaCortaMx(new Date(Date.parse(`${hoy}T12:00:00Z`) + prov.entrega_dias * 864e5).toISOString()))}
        {a.precio ? fila("Precio", `$${fmtNum(a.precio, 2)}`) : null}
        {c.pocosDatos && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Pocos días con existencia en la ventana: la venta real puede no ser confiable.</p>}
      </div>
    </div>
  );
}

function AjustesProveedor({ prov }: { prov: PlanProveedor }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [v, setV] = useState({
    codigo: prov.codigo ?? "",
    entrega_dias: String(prov.entrega_dias),
    recibe_parcial: prov.recibe_parcial,
    tope_usd: prov.tope_usd != null ? String(prov.tope_usd) : "",
    contenedor_cbm: prov.contenedor_cbm != null ? String(prov.contenedor_cbm) : "",
    base_meses: String(prov.base_meses),
    objetivo_meses: String(prov.objetivo_meses),
    punto_meses: String(prov.punto_meses),
    cobertura_meses: String(prov.cobertura_meses),
  });
  const china = prov.origen === "china";
  const campo = (k: keyof typeof v, label: string, extra?: string) => (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} inputMode={k === "codigo" ? "text" : "decimal"} placeholder={extra} />
    </label>
  );
  function guardar() {
    const n = (s: string) => (s.trim() === "" ? null : Number(s));
    start(async () => {
      const r = await ajustesProveedorAction(prov.id, {
        codigo: v.codigo.trim() ? v.codigo.trim().toUpperCase() : null,
        entrega_dias: Number(v.entrega_dias),
        recibe_parcial: v.recibe_parcial,
        tope_usd: n(v.tope_usd),
        contenedor_cbm: n(v.contenedor_cbm),
        base_meses: Number(v.base_meses),
        objetivo_meses: Number(v.objetivo_meses),
        punto_meses: Number(v.punto_meses),
        cobertura_meses: Number(v.cobertura_meses),
      });
      if (!r.ok) return toast(r.error, "error");
      toast("Ajustes guardados", "success");
      router.refresh();
    });
  }
  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold">Ajustes de {prov.nombre}</summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {campo("codigo", "Siglas del folio", "Ej. JGH")}
        {campo("entrega_dias", "Entrega (días)")}
        {china ? (
          <>
            {campo("punto_meses", "Pedir al bajar de (meses)")}
            {campo("cobertura_meses", "Cobertura (meses)")}
            {campo("contenedor_cbm", "Contenedor (CBM)")}
          </>
        ) : (
          <>
            {campo("base_meses", "Base (meses)")}
            {campo("objetivo_meses", "Objetivo (meses)")}
            {campo("tope_usd", "Tope por OC (USD)")}
          </>
        )}
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={v.recibe_parcial} onChange={(e) => setV({ ...v, recibe_parcial: e.target.checked })} />
          Puede llegar por partes
        </label>
        <Button type="button" variant="secondary" onClick={guardar} loading={pend}>Guardar ajustes</Button>
      </div>
    </details>
  );
}
