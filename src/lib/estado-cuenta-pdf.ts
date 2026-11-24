"use client";

import { leerEstadoCuenta, type EstadoCuentaLeido } from "@/lib/estado-cuenta";
import { filasDeItems } from "@/lib/factura-lector";

/** Lee el estado de cuenta en el navegador (pdf.js), pagina por pagina. */
export async function leerEstadoCuentaPdf(f: File): Promise<EstadoCuentaLeido> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    paginas.push(filasDeItems(tc.items as { str: string; transform: number[] }[]));
  }
  return leerEstadoCuenta(paginas);
}
