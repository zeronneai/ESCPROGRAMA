"use client";

import { useState } from "react";
import { textoDocumentoAction } from "@/actions/pagos";
import { Spinner } from "@/components/ui";
import { renglonesPdf } from "@/lib/pdf-texto";
import { leerDocProveedor, type DocProveedor } from "@/lib/proforma-lector";

const ACEPTA = ".pdf,.xlsx,.docx,.xls,.doc,.png,.jpg,.jpeg,.webp";

/**
 * Cuadro para arrastrar la proforma o factura del proveedor (PDF, Excel o Word).
 * Lee lo que puede y avisa; el archivo se adjunta al pago al guardar.
 */
export function DocProveedorDrop({ proveedores, onLeido, archivo }: { proveedores: { id: string; nombre: string }[]; onLeido: (doc: DocProveedor | null, file: File, error?: string) => void; archivo?: File | null }) {
  const [sobre, setSobre] = useState(false);
  const [leyendo, setLeyendo] = useState(false);

  async function leer(f: File | undefined) {
    setSobre(false);
    if (!f) return;
    setLeyendo(true);
    try {
      const n = f.name.toLowerCase();
      let renglones: string[] | null = null;
      if (n.endsWith(".pdf") || f.type === "application/pdf") renglones = await renglonesPdf(f);
      else if (/\.(png|jpe?g|webp)$/.test(n)) return onLeido(null, f, "Es una imagen: se adjunta, pero los datos se capturan a mano.");
      else {
        const fd = new FormData();
        fd.set("file", f);
        const r = await textoDocumentoAction(fd);
        if (!r.ok) return onLeido(null, f, r.error);
        renglones = r.renglones;
      }
      if (!renglones.join("").trim()) return onLeido(null, f, "El documento no tiene texto (parece escaneado): se adjunta, pero los datos se capturan a mano.");
      onLeido(leerDocProveedor(renglones, proveedores), f);
    } catch {
      onLeido(null, f, "No pude leer el documento. Se adjunta y capturas los datos a mano.");
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => { e.preventDefault(); void leer(e.dataTransfer.files?.[0]); }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition ${sobre ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"}`}
    >
      {leyendo ? (
        <span className="flex items-center gap-2 text-slate-700"><Spinner className="h-4 w-4" /> Leyendo el documento...</span>
      ) : archivo ? (
        <>
          <span className="font-medium text-slate-900">{archivo.name}</span>
          <span className="text-xs text-slate-500">Se adjunta al guardar. Arrastra otro para cambiarlo.</span>
        </>
      ) : (
        <>
          <span className="font-medium text-slate-900">Arrastra aquí la proforma o factura del proveedor</span>
          <span className="text-xs text-slate-500">PDF, Excel o Word. Se llenan los datos solos y el documento queda adjunto.</span>
        </>
      )}
      <input type="file" accept={ACEPTA} className="hidden" onChange={(e) => void leer(e.target.files?.[0])} />
    </label>
  );
}
