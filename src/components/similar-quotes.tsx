"use client";

import { useEffect, useState } from "react";
import { searchSimilarAction, type SimilarQuote } from "@/actions/sourcing";
import { Alert, Button } from "@/components/ui";

const RESULT_LABEL = { sin_respuesta: "Sin respuesta", ganada: "Ganada", perdida: "Perdida" } as const;

/** "Cotizaciones anteriores parecidas" (solo comprador). "Usar como base" solo precarga el formulario. */
export function SimilarQuotes({
  itemId, producto, onUse,
}: {
  itemId: string;
  producto: string;
  onUse: (q: SimilarQuote) => void;
}) {
  const [rows, setRows] = useState<SimilarQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void searchSimilarAction({ name: producto, excludeItem: itemId }).then((r) => {
      if (!alive) return;
      if (r.ok) setRows(r.rows);
      else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [itemId, producto]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (rows === null) return <p className="text-xs text-slate-500">Buscando cotizaciones parecidas...</p>;
  if (rows.length === 0) return <p className="text-xs text-slate-500">No hay cotizaciones anteriores parecidas.</p>;

  return (
    <details className="rounded-md border border-slate-200" open>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Cotizaciones anteriores parecidas ({rows.length})</summary>
      <div className="overflow-x-auto border-t border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Producto</th><th className="px-2 py-1">Costo</th><th className="px-2 py-1">Envío</th>
              <th className="px-2 py-1">Proveedor</th><th className="px-2 py-1">Precio elegido</th><th className="px-2 py-1">Resultado</th><th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.item_id}-${r.version}`} className="border-t border-slate-100">
                <td className="px-2 py-1 whitespace-nowrap">{new Date(r.quoted_at).toLocaleDateString("es-MX", { dateStyle: "short" })}</td>
                <td className="px-2 py-1">{r.producto}<div className="text-slate-400">{r.cliente}</div></td>
                <td className="px-2 py-1 tabular-nums">${Number(r.costo).toFixed(2)} {r.moneda}</td>
                <td className="px-2 py-1 tabular-nums">{r.envio ? `$${Number(r.envio).toFixed(2)}` : "-"}</td>
                <td className="px-2 py-1">{r.proveedor ?? "-"}</td>
                <td className="px-2 py-1">{r.precio_elegido ? `P${r.precio_elegido} ($${Number(r.valor_elegido).toFixed(2)})` : "-"}</td>
                <td className="px-2 py-1">{r.resultado ? RESULT_LABEL[r.resultado] : "-"}</td>
                <td className="px-2 py-1"><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onUse(r)}>Usar como base</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
