"use client";

import { useState } from "react";
import { money2 } from "@/lib/ventas";

/** Renglon de comision en edicion (textos de los inputs). */
export interface FilaCom {
  id: string;
  clave: string | null;
  descripcion: string;
  cantidad: number | null;
  imp: string;
  env: string;
  pct: string;
}
export type CampoCom = "imp" | "env" | "pct";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => (s === "" ? 0 : Number(s));
/** Comision = (importe - envio incluido) x %. */
export const comisionDe = (f: FilaCom) => (f.imp !== "" && f.pct !== "" ? r2((Math.max(num(f.imp) - num(f.env), 0) * num(f.pct)) / 100) : null);
export const completa = (f: FilaCom) => f.imp !== "" && f.pct !== "" && num(f.env) <= num(f.imp);
export const filaDe = (l: { id: string; clave?: string | null; descripcion: string; cantidad: number | null; importe?: number | null; envio?: number | null; comision_pct?: number | null; pct?: number | null }): FilaCom => ({
  id: l.id, clave: l.clave ?? null, descripcion: l.descripcion, cantidad: l.cantidad,
  imp: l.importe != null ? String(l.importe) : "", env: l.envio ? String(l.envio) : "", pct: (l.comision_pct ?? l.pct) != null ? String(l.comision_pct ?? l.pct) : "",
});
/** Para guardar: { id, importe, envio, comision_pct }. */
export const payloadDe = (f: FilaCom) => ({ id: f.id, importe: f.imp === "" ? null : Number(f.imp), envio: f.env === "" ? 0 : Number(f.env), comision_pct: f.pct === "" ? null : Number(f.pct) });

/** Reparte el envio total entre los articulos segun su importe (lo que sobra de redondeo va al ultimo). */
export function repartirEnvio(importes: number[], total: number): number[] {
  const suma = importes.reduce((a, x) => a + x, 0);
  if (!(total > 0) || !(suma > 0)) return importes.map(() => 0);
  const out = importes.map((x) => r2((total * x) / suma));
  const dif = r2(total - out.reduce((a, x) => a + x, 0));
  let k = importes.length - 1;
  while (k > 0 && importes[k] === 0) k--;
  out[k] = r2(out[k] + dif);
  return out;
}

/**
 * Tabla de comision por articulo: importe sin IVA, envio incluido (opcional) y %.
 * puede(i, campo) dice que se deja editar (por ejemplo, venta pagada: solo lo que falta).
 */
export function ComisionEditor({ filas, setFilas, moneda, puede = () => true }: { filas: FilaCom[]; setFilas: (f: FilaCom[]) => void; moneda: string; puede?: (i: number, c: CampoCom) => boolean }) {
  const [todos, setTodos] = useState("");
  const [modo, setModo] = useState<"no" | "total" | "articulo">(() => (filas.some((f) => num(f.env) > 0) ? "articulo" : "no"));
  const [envTotal, setEnvTotal] = useState("");
  const algunEnv = filas.some((_, i) => puede(i, "env"));
  const set = (i: number, c: CampoCom, v: string) => setFilas(filas.map((f, j) => (j === i ? { ...f, [c]: v.replace(/[^\d.]/g, "") } : f)));
  const aplicarTotal = (t: string) => {
    setEnvTotal(t);
    const rep = repartirEnvio(filas.map((f) => num(f.imp)), num(t));
    setFilas(filas.map((f, i) => (puede(i, "env") ? { ...f, env: rep[i] ? String(rep[i]) : "" } : f)));
  };
  const cambiarModo = (m: typeof modo) => {
    setModo(m);
    if (m === "no") setFilas(filas.map((f, i) => (puede(i, "env") ? { ...f, env: "" } : f)));
    if (m === "total") aplicarTotal(envTotal || String(r2(filas.reduce((a, f) => a + num(f.env), 0)) || ""));
  };
  const total = filas.reduce((a, f) => a + (comisionDe(f) ?? 0), 0);
  const envSuma = r2(filas.reduce((a, f) => a + num(f.env), 0));
  const cls = (v: string, ok = v !== "") => `rounded border px-2 py-1 text-right text-sm disabled:bg-slate-50 disabled:text-slate-600 ${ok ? "border-slate-300" : "border-amber-400 bg-amber-50"}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        {filas.length > 1 && (
          <span className="flex items-center gap-1.5">
            Mismo % para todos
            <input value={todos} onChange={(e) => setTodos(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="%" className="w-14 rounded border border-slate-300 px-2 py-1 text-right" />
            <button type="button" disabled={todos === ""} onClick={() => setFilas(filas.map((f, i) => (puede(i, "pct") ? { ...f, pct: todos } : f)))} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-50">Aplicar</button>
          </span>
        )}
        {algunEnv && (
          <span className="flex flex-wrap items-center gap-1.5">
            ¿El envío viene incluido en los artículos?
            {(["no", "total", "articulo"] as const).map((m) => (
              <button key={m} type="button" onClick={() => cambiarModo(m)} className={`rounded-full border px-2.5 py-0.5 ${modo === m ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
                {m === "no" ? "No" : m === "total" ? "Sí, en el total" : "Sí, por artículo"}
              </button>
            ))}
            {modo === "total" && (
              <span className="flex items-center gap-1">
                Envío total $
                <input value={envTotal} onChange={(e) => aplicarTotal(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0.00" className="w-24 rounded border border-slate-300 px-2 py-1 text-right" />
              </span>
            )}
          </span>
        )}
      </div>
      {modo !== "no" && <p className="text-xs text-slate-500">La comisión se calcula sobre el importe menos el envío. {modo === "total" ? "El envío se reparte entre los artículos según su importe." : ""}</p>}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {filas.map((f, i) => {
          const c = comisionDe(f);
          const malEnv = num(f.env) > num(f.imp) && f.imp !== "";
          return (
            <div key={f.id} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1">
                {f.clave && <span className="font-mono text-xs text-slate-500">{f.clave} · </span>}
                {f.descripcion}
                {f.cantidad != null && <span className="text-xs text-slate-500"> · {f.cantidad} pza(s)</span>}
              </span>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                Importe
                <input value={f.imp} disabled={!puede(i, "imp")} onChange={(e) => set(i, "imp", e.target.value)} inputMode="decimal" placeholder="0.00" className={`w-24 ${cls(f.imp)}`} />
              </label>
              {modo === "articulo" && (
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  − Envío
                  <input value={f.env} disabled={!puede(i, "env")} onChange={(e) => set(i, "env", e.target.value)} inputMode="decimal" placeholder="0" className={`w-20 ${cls(f.env, !malEnv)}`} />
                </label>
              )}
              {modo === "total" && num(f.env) > 0 && <span className="text-xs text-slate-500">− envío {money2(num(f.env), moneda)}</span>}
              <label className="flex items-center gap-1 text-xs text-slate-600">
                %
                <input value={f.pct} disabled={!puede(i, "pct")} onChange={(e) => set(i, "pct", e.target.value)} inputMode="decimal" placeholder="0" className={`w-14 ${cls(f.pct)}`} />
              </label>
              <span className="w-24 text-right font-medium tabular-nums">{c == null ? "-" : money2(c, moneda)}</span>
              {malEnv && <span className="text-xs text-red-700">El envío es mayor que el importe</span>}
            </div>
          );
        })}
      </div>
      <p className="text-right text-xs text-slate-600">
        {envSuma > 0 && <>Envío incluido: {money2(envSuma, moneda)} · </>}Comisión total: <b className="tabular-nums">{money2(total, moneda)}</b>
      </p>
    </div>
  );
}
