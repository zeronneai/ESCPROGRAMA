/**
 * Fuentes que usa la plantilla del PDF. Son las fuentes estandar de PDF (Helvetica) que
 * pdfkit carga desde `pdfkit/js/standard-fonts/<archivo>.cjs` con un "import map" (`#standard-fonts/*`),
 * algo que el trazado de archivos de Next/Vercel no detecta solo: por eso `next.config.ts`
 * las incluye explicitamente (outputFileTracingIncludes).
 *
 * Si cambias la tipografia de la plantilla, cambia SOLO estas constantes.
 */
export const PDF_FONT = { regular: "Helvetica", bold: "Helvetica-Bold" } as const;

/** Nombre del archivo de pdfkit para cada fuente estandar (sin extension). */
export const STANDARD_FONT_FILE: Record<string, string> = {
  Helvetica: "Helvetica",
  "Helvetica-Bold": "HelveticaBold",
  "Helvetica-Oblique": "HelveticaOblique",
  "Helvetica-BoldOblique": "HelveticaBoldOblique",
};

/** Archivos de fuente que la plantilla necesita en produccion. */
export const REQUIRED_FONT_FILES = [...new Set(Object.values(PDF_FONT))].map((f) => `standard-fonts/${STANDARD_FONT_FILE[f]}.cjs`);

/** Ruta de la funcion del PDF (clave de outputFileTracingIncludes). */
export const PDF_ROUTE_KEY = "/api/pdf/[requestId]";
