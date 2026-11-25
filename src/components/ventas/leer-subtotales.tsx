"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { guardarSubtotalAction, ventasSubtotalEstimadoAction } from "@/actions/ventas";
import { Button } from "@/components/ui";
import { leerFacturaXml, type FacturaLeida } from "@/lib/factura-lector";
import { leerFacturaPdf } from "@/lib/pdf-cliente";

/**
 * Vuelve a leer las facturas ya subidas y guarda su subtotal exacto (sin IVA) en las ventas
 * que lo tenian estimado. Corre en el navegador con el mismo lector de cuando se sube la factura.
 */
export function LeerSubtotales({ pendientes }: { pendientes: number }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"listo" | "leyendo" | "fin">("listo");
  const [avance, setAvance] = useState({ hechas: 0, total: 0, ok: 0 });
  const [fallas, setFallas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const leer = async (id: string, xml: boolean, pdf: boolean): Promise<FacturaLeida | null> => {
    if (xml) {
      const r = await fetch(`/api/ventas/${id}/factura?tipo=xml`);
      if (r.ok) return leerFacturaXml(await r.text());
    }
    if (pdf) {
      const r = await fetch(`/api/ventas/${id}/factura`);
      if (r.ok) return leerFacturaPdf(new File([await r.blob()], "factura.pdf", { type: "application/pdf" }));
    }
    return null;
  };

  const correr = async () => {
    setError(null);
    setFallas([]);
    const lista = await ventasSubtotalEstimadoAction();
    if (!lista.ok) return setError(lista.error);
    setEstado("leyendo");
    let ok = 0;
    const malas: string[] = [];
    setAvance({ hechas: 0, total: lista.ventas.length, ok: 0 });
    for (const [i, v] of lista.ventas.entries()) {
      try {
        const f = await leer(v.id, v.xml, v.pdf);
        const sub = f?.subtotal;
        if (sub && sub > 0 && (!v.monto || sub <= v.monto + 0.01)) {
          const r = await guardarSubtotalAction(v.id, sub);
          if (r.ok) ok++;
          else malas.push(`${v.factura ?? "Venta"}: ${r.error}`);
        } else malas.push(`${v.factura ?? "Venta"}: no se encontró el subtotal en la factura`);
      } catch {
        malas.push(`${v.factura ?? "Venta"}: no se pudo leer la factura`);
      }
      setAvance({ hechas: i + 1, total: lista.ventas.length, ok });
    }
    setFallas(malas);
    setEstado("fin");
    router.refresh();
  };

  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-sm text-sky-950">
        {pendientes
          ? <><b>{pendientes}</b> venta(s) con factura tienen el importe sin IVA <b>calculado</b> (total entre el IVA). Léelas de la factura para dejar el subtotal exacto.</>
          : "Todas las ventas con factura ya tienen su subtotal sin IVA exacto."}
      </p>
      {(pendientes > 0 || estado !== "listo") && (
        <Button type="button" variant="secondary" onClick={correr} loading={estado === "leyendo"} disabled={estado === "leyendo"}>
          Leer subtotales de las facturas
        </Button>
      )}
      {estado !== "listo" && (
        <p className="text-xs text-sky-900">
          {estado === "leyendo" ? `Leyendo ${avance.hechas} de ${avance.total}... no cierres esta página.` : `Listo: ${avance.ok} de ${avance.total} quedaron con su subtotal exacto.`}
        </p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {fallas.length > 0 && (
        <details className="text-xs text-slate-700">
          <summary className="cursor-pointer">{fallas.length} no se pudieron leer (se quedan con el cálculo)</summary>
          <ul className="mt-1 list-disc pl-5">{fallas.slice(0, 100).map((f, i) => <li key={i}>{f}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
