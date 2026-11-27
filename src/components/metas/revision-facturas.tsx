"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { guardarVendedorFacturaAction } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { leerFacturaTexto } from "@/lib/factura-lector";
import { renglonesPdf } from "@/lib/pdf-cliente";

export interface FilaRevision {
  id: string;
  factura: string | null;
  fecha: string;
  subio: string | null;
  vendedor_factura: string | null;
  cuenta_para: string;
  solo_equipo: boolean;
  subtotal: number | null;
  moneda: string;
  tiene_pdf: boolean;
  tiene_xml: boolean;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
const pesos = (n: number | null, m: string) => (n == null ? "" : `${n.toLocaleString("es-MX", { style: "currency", currency: m === "USD" ? "USD" : "MXN" })}`);

/** Cada factura del periodo de metas: que vendedor se leyo y a que meta va. Permite probar el lector y corregir. */
export function RevisionFacturas({ filas }: { filas: FilaRevision[] }) {
  const router = useRouter();
  const [buscar, setBuscar] = useState("");
  const [prueba, setPrueba] = useState<Record<string, { vendedor: string | null; renglones: string[] } | "leyendo" | "error">>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const lista = useMemo(() => {
    const b = sinAcentos(buscar.trim());
    return b ? filas.filter((f) => sinAcentos(`${f.factura ?? ""} ${f.vendedor_factura ?? ""} ${f.subio ?? ""} ${f.cuenta_para}`).includes(b)) : filas;
  }, [buscar, filas]);
  const soloEquipo = filas.filter((f) => f.solo_equipo);
  const sinLeer = filas.filter((f) => !f.vendedor_factura && f.tiene_pdf).length;

  const probar = async (f: FilaRevision) => {
    setPrueba((p) => ({ ...p, [f.id]: "leyendo" }));
    try {
      const r = await fetch(`/api/ventas/${f.id}/factura`);
      if (!r.ok) throw new Error();
      const { filas: celdas, lineas } = await renglonesPdf(new File([await r.blob()], "factura.pdf", { type: "application/pdf" }));
      const leida = leerFacturaTexto(lineas, celdas);
      const i = lineas.findIndex((l) => /Vendedor/i.test(l));
      setPrueba((p) => ({ ...p, [f.id]: { vendedor: leida.vendedor, renglones: i >= 0 ? lineas.slice(Math.max(0, i - 1), i + 5) : lineas.slice(0, 20) } }));
      if (leida.vendedor) setManual((m) => ({ ...m, [f.id]: m[f.id] ?? leida.vendedor! }));
    } catch {
      setPrueba((p) => ({ ...p, [f.id]: "error" }));
    }
  };
  const guardar = async (f: FilaRevision) => {
    const n = (manual[f.id] ?? "").trim();
    if (!n) return toast("Escribe el vendedor como viene en la factura.", "error");
    const r = await guardarVendedorFacturaAction(f.id, n);
    if (!r.ok) return toast(r.error, "error");
    toast(`Guardado: ${f.factura ?? "la factura"} ahora dice ${n}.`, "success");
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[11px] text-slate-500">Facturas del periodo</p><p className="text-lg font-bold">{filas.length}</p></div>
        <div className={`rounded-lg border px-3 py-2 ${soloEquipo.length ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"}`}><p className="text-[11px] text-slate-500">Solo equipo (Iván Muñoz)</p><p className="text-lg font-bold">{soloEquipo.length}</p></div>
        <div className={`rounded-lg border px-3 py-2 ${sinLeer ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><p className="text-[11px] text-slate-500">Con PDF y sin vendedor leído</p><p className="text-lg font-bold">{sinLeer}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar folio, vendedor o quien la subió (ej. IVAN)" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm sm:max-w-sm" />
        <button type="button" onClick={() => setBuscar("IVAN")} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50">Solo IVAN</button>
        <button type="button" onClick={() => setBuscar("JUAREZ")} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50">Solo VTS</button>
        <button type="button" onClick={() => setBuscar("CASA LOCAL")} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50">Solo Casa Local</button>
        {buscar && <button type="button" onClick={() => setBuscar("")} className="text-xs text-slate-500 underline">Ver todas</button>}
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
        {lista.slice(0, 300).map((f) => {
          const pr = prueba[f.id];
          return (
            <li key={f.id} className="space-y-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{f.factura ?? "(sin folio)"} <span className="text-xs font-normal text-slate-500">· {f.fecha} · subió {f.subio ?? "?"} · {pesos(f.subtotal, f.moneda)} sin IVA</span></p>
                  <p className="text-xs">
                    Vendedor en la factura: {f.vendedor_factura ? <b>{f.vendedor_factura}</b> : <span className="text-amber-700">{f.tiene_pdf ? "sin leer" : "solo XML (no trae vendedor)"}</span>}
                    {" · "}Cuenta en metas para: <b className={f.solo_equipo ? "text-green-700" : ""}>{f.cuenta_para}</b>
                  </p>
                </div>
                {f.tiene_pdf && (
                  <Button variant="secondary" loading={pr === "leyendo"} onClick={() => probar(f)}>Probar lector</Button>
                )}
              </div>
              {pr === "error" && <p className="text-xs text-red-600">No pude abrir el PDF.</p>}
              {pr && typeof pr === "object" && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 text-xs">
                  <p>El lector encontró: {pr.vendedor ? <b>{pr.vendedor}</b> : <b className="text-red-600">ningún vendedor</b>}</p>
                  <details>
                    <summary className="cursor-pointer text-slate-500">Ver cómo viene el texto del PDF</summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre text-[11px] text-slate-700">{pr.renglones.join("\n")}</pre>
                  </details>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={manual[f.id] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [f.id]: e.target.value }))} placeholder="Vendedor como viene en la factura" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs sm:max-w-xs" />
                    <Button onClick={() => guardar(f)}>Guardar vendedor</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {!lista.length && <li className="px-3 py-4 text-center text-slate-500">No hay facturas con esa búsqueda en el periodo de metas.</li>}
      </ul>
    </div>
  );
}
