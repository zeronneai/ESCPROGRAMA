"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { guardarOrdenCompraAction, guardarSubtotalAction, guardarVendedorFacturaAction, ventasSubtotalEstimadoAction } from "@/actions/ventas";
import { Button } from "@/components/ui";
import { leerFacturaXml, type FacturaLeida } from "@/lib/factura-lector";
import { leerFacturaPdf } from "@/lib/pdf-cliente";

/**
 * Vuelve a leer las facturas ya subidas y guarda su subtotal exacto (sin IVA) en las ventas
 * que lo tenian estimado. Corre en el navegador con el mismo lector de cuando se sube la factura.
 */
export function LeerSubtotales({ pendientes, sinVendedor = 0 }: { pendientes: number; sinVendedor?: number }) {
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
        let bien = false;
        const fallo: string[] = [];
        const sub = f?.subtotal;
        if (v.sub) {
          if (sub && sub > 0 && (!v.monto || sub <= v.monto + 0.01)) {
            const r = await guardarSubtotalAction(v.id, sub);
            if (r.ok) bien = true;
            else fallo.push(r.error);
          } else fallo.push("no se encontró el subtotal");
        }
        if (v.vend) {
          // El XML no trae vendedor: si hay PDF se lee de ahi.
          let vend = f?.vendedor ?? null;
          if (!vend && v.xml && v.pdf) {
            const r = await fetch(`/api/ventas/${v.id}/factura`);
            if (r.ok) vend = (await leerFacturaPdf(new File([await r.blob()], "factura.pdf", { type: "application/pdf" }))).vendedor;
          }
          if (vend) {
            const r = await guardarVendedorFacturaAction(v.id, vend);
            if (r.ok) bien = true;
            else fallo.push(r.error);
          } else if (!v.sub) fallo.push("no trae el vendedor");
        }
        if (v.oc) {
          // La orden de compra solo viene en el PDF.
          let oc = f?.ordenCompra ?? null;
          if (!oc && v.xml && v.pdf) {
            const r = await fetch(`/api/ventas/${v.id}/factura`);
            if (r.ok) oc = (await leerFacturaPdf(new File([await r.blob()], "factura.pdf", { type: "application/pdf" }))).ordenCompra ?? null;
          }
          if (oc) {
            const r = await guardarOrdenCompraAction(v.id, oc);
            if (r.ok) bien = true;
            else fallo.push(r.error);
          }
        }
        if (bien) ok++;
        if (fallo.length) malas.push(`${v.factura ?? "Venta"}: ${fallo.join(", ")}`);
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
        {pendientes || sinVendedor ? (
          <>
            {pendientes ? <><b>{pendientes}</b> venta(s) con factura tienen el importe sin IVA <b>calculado</b>. </> : null}
            {sinVendedor ? <><b>{sinVendedor}</b> venta(s) no tienen leído el <b>vendedor de la factura</b> (ej. CASA LOCAL). </> : null}
            Léelas de las facturas para que las metas cuenten exacto.
          </>
        ) : "Todas las ventas con factura ya tienen su subtotal exacto y su vendedor."}
        {" "}También lee la orden de compra de las facturas de Pegatron.
      </p>
      {(

        <Button type="button" variant="secondary" onClick={correr} loading={estado === "leyendo"} disabled={estado === "leyendo"}>
          Leer datos de las facturas
        </Button>
      )}
      {estado !== "listo" && (
        <p className="text-xs text-sky-900">
          {estado === "leyendo" ? `Leyendo ${avance.hechas} de ${avance.total}... no cierres esta página.` : `Listo: ${avance.ok} de ${avance.total} quedaron completas.`}
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
