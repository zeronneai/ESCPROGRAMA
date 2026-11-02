"use client";

import { useEffect, useRef, useState } from "react";
import { searchArticulosAction } from "@/actions/articulos";
import { Input, Spinner } from "@/components/ui";
import { ESTATUS_ARTICULO, type Articulo, type BitacoraArticulo } from "@/lib/articulos";

/** Buscar en el catalogo (solo vendibles) y agregar a la lista. */
export function ArticuloSearch({ onPick, exclude = [] }: { onPick: (a: Articulo) => void; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Articulo[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchArticulosAction(q);
      if (n === seq.current) {
        setRes(r);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const shown = res.filter((a) => !exclude.includes(a.id));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {loading ? <Spinner className="h-4 w-4" /> : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
      </span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar artículo por nombre o clave (ej. guante nitrilo M)" className="pl-9" autoComplete="off" />
      {q.trim().length >= 2 && !loading && (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Sin artículos activos con ese texto.</p>
          ) : (
            shown.map((a) => (
              <button key={a.id} type="button" onClick={() => { onPick(a); setQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="text-slate-900">{a.nombre}</span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  {a.clave}
                  {a.estatus !== "activo" && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ESTATUS_ARTICULO[a.estatus].chip}`}>{ESTATUS_ARTICULO[a.estatus].label}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Lista de articulos de un registro, con cantidad opcional. */
export function ArticulosList({
  items, readOnly, busy, onAdd, onRemove, onQty,
}: {
  items: BitacoraArticulo[];
  readOnly: boolean;
  busy?: boolean;
  onAdd: (a: Articulo) => void;
  onRemove: (a: BitacoraArticulo) => void;
  onQty: (a: BitacoraArticulo, cantidad: number | null) => void;
}) {
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {items.map((a) => (
            <li key={a.articulo_id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="text-slate-900">{a.nombre}</p>
                <p className="text-xs text-slate-500">{a.clave}</p>
              </div>
              {readOnly ? (
                a.cantidad ? <span className="shrink-0 text-sm text-slate-700">{a.cantidad.toLocaleString("es-MX")}</span> : null
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    defaultValue={a.cantidad ?? ""}
                    inputMode="decimal"
                    placeholder="Cant."
                    disabled={busy}
                    onBlur={(e) => {
                      const n = e.target.value.trim() ? Number(e.target.value) : null;
                      if (n !== a.cantidad && (n === null || n > 0)) onQty(a, n);
                    }}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <button type="button" disabled={busy} onClick={() => onRemove(a)} className="px-1 text-lg leading-none text-slate-400 hover:text-red-600" aria-label="Quitar artículo">×</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <ArticuloSearch onPick={onAdd} exclude={items.map((i) => i.articulo_id)} />}
      {readOnly && items.length === 0 && <p className="text-sm text-slate-500">Sin artículos.</p>}
    </div>
  );
}
