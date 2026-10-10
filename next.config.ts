import type { NextConfig } from "next";

/**
 * PDF de cotizacion (/api/pdf/[requestId]) con @react-pdf/renderer.
 *
 * pdfkit carga sus fuentes estandar con un "import map" (`#standard-fonts/Helvetica` ->
 * js/standard-fonts/Helvetica.cjs). El trazado de archivos de Next/Vercel (nft) no sigue esas
 * importaciones, asi que sin esto la funcion falla con
 *   Cannot find module '.../pdfkit/js/standard-fonts/Helvetica.cjs'
 * Con pnpm el paquete vive en node_modules/.pnpm/pdfkit@<version>/node_modules/pdfkit.
 * `pnpm build` ejecuta scripts/verify-pdf-trace.mjs para comprobar que los archivos quedaron incluidos.
 */
const PDF_ROUTE = "/api/pdf/[requestId]";

const config: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // No empaquetar estas librerias: se cargan desde node_modules en tiempo de ejecucion.
  serverExternalPackages: ["@react-pdf/renderer", "pdfkit"],
  outputFileTracingIncludes: {
    [PDF_ROUTE]: [
      // pnpm (node_modules/.pnpm) y, por si se instala con npm/yarn, node_modules plano.
      "./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**/*",
      "./node_modules/pdfkit/js/**/*",
      // Logo del encabezado del PDF (se lee con fs desde la funcion).
      "./public/logo-esc.png",
    ],
  },
};

export default config;
