"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { guardarImportesAction, ventasSinImporteAction } from "@/actions/ventas";
import { Button, Card } from "@/components/ui";
import { emparejarImportes } from "@/lib/comisiones";
import { leerFacturaXml, type FacturaLeida } from "@/lib/factura-lector";
import { leerFacturaPdf } from "@/lib/pdf-cliente";

type Res = { id: string; factura: string | null; llenos: number; total: number; nota?: string };

/**
 * Vuelve a leer las facturas ya subidas (XML si hay, si no el PDF) y llena el importe de cada articulo.
 * Se hace en el navegador con el mismo lector que se usa al subir la factura.
 */
export function LeerImportes() {
  const router = useRouter();
  const [estado, setEstado] = useState<"listo" | "leyendo" | "fin">("listo");
  const [avance, setAvance] = useState({ hechas: 0, total: 0 });
  const [res, setRes] = useState<Res[]>([]);
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
    setRes([]);
    const lista = await ventasSinImporteAction();
    if (!lista.ok) return setError(lista.error);
    setEstado("leyendo");
    setAvance({ hechas: 0, total: lista.ventas.length });
    const out: Res[] = [];
    for (const [i, v] of lista.ventas.entries()) {
      try {
        const f = await leer(v.id, v.xml, v.pdf);
        if (!f) out.push({ id: v.id, factura: v.factura, llenos: 0, total: v.lineas.length, nota: "No se pudo abrir el archivo" });
        else {
          const m = emparejarImportes(v.lineas, f.lineas);
          if (m.size) {
            const r = await guardarImportesAction(v.id, v.lineas.filter((l) => m.has(l.id)).map((l) => ({ id: l.id, importe: m.get(l.id)!, comision_pct: l.comision_pct })));
            out.push(r.ok ? { id: v.id, factura: v.factura, llenos: m.size, total: v.lineas.length } : { id: v.id, factura: v.factura, llenos: 0, total: v.lineas.length, nota: r.error });
          } else out.push({ id: v.id, factura: v.factura, llenos: 0, total: v.lineas.length, nota: "No se pudieron emparejar los artículos" });
        }
      } catch {
        out.push({ id: v.id, factura: v.factura, llenos: 0, total: v.lineas.length, nota: "No se pudo leer la factura" });
      }
      setAvance({ hechas: i + 1, total: lista.ventas.length });
      setRes([...out]);
    }
    setEstado("fin");
    router.refresh();
  };

  const completas = res.filter((r) => r.llenos === r.total && r.total > 0).length;
  const faltan = res.filter((r) => r.llenos < r.total);
  return (
    <Card className="space-y-3 border-sky-200 bg-sky-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">Importes de facturas anteriores</p>
          <p className="text-xs text-slate-600">Las facturas subidas antes de las comisiones no tienen el importe de cada artículo. Esto vuelve a leer su PDF o XML y lo llena solo; después nada más pones el %.</p>
        </div>
        <Button type="button" variant="secondary" onClick={correr} loading={estado === "leyendo"} disabled={estado === "leyendo"}>
          {estado === "fin" ? "Volver a leer" : "Leer importes"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {estado !== "listo" && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${avance.total ? (avance.hechas / avance.total) * 100 : 100}%` }} />
          </div>
          <p className="text-sm text-slate-700">
            {estado === "leyendo" ? `Leyendo ${avance.hechas} de ${avance.total} factura(s)...` : avance.total === 0 ? "No hay facturas sin importe." : `Listo: ${completas} de ${avance.total} factura(s) quedaron con todos sus importes.`}
          </p>
          {estado === "fin" && faltan.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-amber-800">{faltan.length} factura(s) quedaron incompletas: el importe se pone a mano en la factura</summary>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                {faltan.map((r) => (
                  <li key={r.id}>
                    <a href={`/vendedor/bitacora/venta/${r.id}?comision=1#comision`} className="font-semibold underline">{r.factura ?? "Venta"}</a>: {r.llenos} de {r.total} artículo(s){r.nota ? ` · ${r.nota}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
