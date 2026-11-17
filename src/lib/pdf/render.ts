import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import type { PdfModel } from "./model";
import { QuoteDocument } from "./quote-template";

/** Imagenes de las partidas: ruta en storage -> archivo (solo PNG o JPG; react-pdf no lee otros). */
export type PdfImagenes = Record<string, Buffer>;

export async function renderQuotePdf(model: PdfModel, imagenes: PdfImagenes = {}): Promise<Buffer> {
  let logo: Buffer | undefined;
  try {
    logo = await readFile(path.join(process.cwd(), "public", "logo-esc.png"));
  } catch {
    logo = undefined;
  }
  // El cast evita el desajuste de tipos entre elementos de react y react-pdf.
  return renderToBuffer(createElement(QuoteDocument, { model, logoSrc: logo, imagenes }) as never);
}
