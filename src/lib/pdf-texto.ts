"use client";

import { filasDeItems } from "@/lib/factura-lector";

/** Renglones de texto de un PDF, leidos en el navegador con pdf.js. */
export async function renglonesPdf(f: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(...filasDeItems(tc.items as { str: string; transform: number[] }[]).map((r) => r.map((c) => c.s).join("  ")));
  }
  return out;
}
