"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unirProspectoAction } from "@/actions/bitacora";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

export interface VentaCandidata {
  customer_id: string;
  cliente: string;
  factura: string | null;
  fecha: string;
  monto: number | null;
  moneda: string;
}

/**
 * El prospecto ya compro pero la factura salio con otro nombre (razon social) y se registro en
 * Ventas diarias como otro cliente: se elige esa venta y se unen.
 */
export function UnirProspecto({ bitacoraId, prospecto, ventas }: { bitacoraId: string; prospecto: string; ventas: VentaCandidata[] }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [sel, setSel] = useState<VentaCandidata | null>(null);
  const unir = () =>
    sel &&
    start(async () => {
      const r = await unirProspectoAction(bitacoraId, sel.customer_id);
      if (!r.ok) return toast(r.error, "error");
      toast(`Listo: ${prospecto} ya es cliente y quedó unido con su factura.`, "success");
      router.refresh();
    });

  if (!abierto)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-sm text-green-900"><strong>¿Ya te compró y subiste la factura en Ventas diarias con otro nombre?</strong> Únelo con esa venta para que pase a cliente.</p>
        <Button type="button" variant="secondary" onClick={() => setAbierto(true)}>Unir con su venta</Button>
      </div>
    );
  return (
    <div className="space-y-3 rounded-xl border-2 border-green-600 bg-white px-4 py-3">
      <p className="text-sm font-semibold text-slate-900">¿Cuál es la venta de {prospecto}?</p>
      {ventas.length === 0 ? (
        <p className="text-sm text-slate-600">No encontré ventas recientes a otro cliente. Primero sube la factura en Ventas diarias.</p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-auto">
          {ventas.map((v) => (
            <button
              key={`${v.customer_id}-${v.factura}-${v.fecha}`}
              type="button"
              onClick={() => setSel(v)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm ${sel === v ? "border-green-600 bg-green-50 ring-2 ring-green-600" : "border-slate-200 hover:border-slate-400"}`}
            >
              <span>
                <span className="font-medium text-slate-900">{v.cliente}</span>
                <span className="block text-xs text-slate-500">
                  {v.factura ? `Factura ${v.factura} · ` : ""}
                  {new Date(`${v.fecha}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                </span>
              </span>
              {v.monto != null && <span className="shrink-0 tabular-nums text-slate-700">${v.monto.toLocaleString("es-MX")} {v.moneda}</span>}
            </button>
          ))}
        </div>
      )}
      {sel && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Se quedan juntos como <b>{prospecto}</b> (con la razón social y RFC de la factura): sus ventas, su historial de prospección y sus cotizaciones. &quot;{sel.cliente}&quot; ya no sale como cliente aparte. Las siguientes facturas ya lo encuentran solo.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={unir} loading={pend} disabled={!sel}>Unir y pasar a cliente</Button>
        <Button type="button" variant="secondary" onClick={() => { setAbierto(false); setSel(null); }}>Cancelar</Button>
      </div>
    </div>
  );
}
