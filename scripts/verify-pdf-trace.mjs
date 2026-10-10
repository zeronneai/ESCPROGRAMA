/**
 * Verifica, DESPUES de `next build`, que la funcion del PDF lleve los archivos de fuentes de pdfkit
 * y que un PDF se pueda generar usando SOLO los archivos trazados (simula el paquete de Vercel).
 * Uso:  node scripts/verify-pdf-trace.mjs        (lo ejecuta `pnpm build` automaticamente)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const routeDir = path.join(root, ".next/server/app/api/pdf/[requestId]");
const nftFile = path.join(routeDir, "route.js.nft.json");
const REQUIRED = ["standard-fonts/Helvetica.cjs", "standard-fonts/HelveticaBold.cjs"];

if (!existsSync(nftFile)) {
  console.error(`verify-pdf-trace: no existe ${path.relative(root, nftFile)}. Ejecuta primero "next build".`);
  process.exit(1);
}
const nft = JSON.parse(readFileSync(nftFile, "utf8"));
const abs = nft.files.map((f) => path.resolve(routeDir, f));

// 1) Los archivos de fuente deben estar en el trazado de la funcion.
const missing = REQUIRED.filter((r) => !abs.some((f) => f.includes(`${path.sep}pdfkit${path.sep}js${path.sep}`) && f.endsWith(r.replace("/", path.sep))));
if (missing.length) {
  console.error("verify-pdf-trace: FALTAN en el trazado de /api/pdf/[requestId]:", missing.join(", "));
  console.error('Revisa "outputFileTracingIncludes" en next.config.ts (pnpm guarda pdfkit en node_modules/.pnpm).');
  process.exit(1);
}
console.log(`verify-pdf-trace: fuentes en el trazado OK (${REQUIRED.join(", ")}) de ${nft.files.length} archivos`);

// 2) Simula la funcion: copia SOLO lo trazado (conservando enlaces simbolicos) y genera un PDF alli.
const sandbox = mkdtempSync(path.join(tmpdir(), "pdf-trace-"));
try {
  const copy = (src) => {
    const rel = path.relative(root, src);
    if (rel.startsWith("..")) return;
    const dest = path.join(sandbox, rel);
    if (existsSync(dest)) return;
    mkdirSync(path.dirname(dest), { recursive: true });
    const st = lstatSync(src);
    if (st.isSymbolicLink()) {
      // Solo el enlace: los archivos reales del destino vienen por separado en el trazado.
      symlinkSync(readlinkSync(src), dest);
    } else if (!st.isDirectory()) {
      cpSync(src, dest);
    }
  };
  for (const f of abs) if (existsSync(f) || (() => { try { lstatSync(f); return true; } catch { return false; } })()) copy(f);

  // Prueba representativa: fuentes estandar (normal y negrita), texto largo con acentos (salto de linea),
  // pie de pagina con numero de pagina y el logo PNG leido desde ./public (debe estar en el trazado).
  writeFileSync(
    path.join(sandbox, "render.cjs"),
    `const fs = require("node:fs");
const path = require("node:path");
const rp = require.resolve("@react-pdf/renderer");
const { renderToBuffer, Document, Page, Text, View, Image } = require("@react-pdf/renderer");
const React = require(require.resolve("react", { paths: [path.dirname(rp)] }));
const e = React.createElement;
const logo = fs.readFileSync(path.join(process.cwd(), "public", "logo-esc.png"));
const long = "Atención: descripción larga con acentos y ñ para forzar saltos de línea en la tabla del PDF. ".repeat(12);
const doc = e(Document, null, e(Page, { size: "LETTER", style: { padding: 36 } },
  e(Image, { src: logo, style: { width: 105, height: 30 } }),
  e(Text, { style: { fontFamily: "Helvetica" } }, "Prueba Helvetica " + long),
  e(View, { fixed: true }, e(Text, { style: { fontFamily: "Helvetica-Bold" } }, "Prueba Helvetica-Bold")),
  e(Text, { fixed: true, render: ({ pageNumber, totalPages }) => pageNumber + " / " + totalPages })));
renderToBuffer(doc).then((b) => { if (!String(b.subarray(0, 5)).startsWith("%PDF")) throw new Error("no es un PDF"); console.log("PDF generado con solo los archivos trazados:", b.length, "bytes"); }).catch((err) => { console.error(String((err && err.stack) || err)); process.exit(2); });
`,
  );
  execFileSync(process.execPath, ["render.cjs"], { cwd: sandbox, stdio: "inherit" });
} catch (err) {
  console.error("verify-pdf-trace: la funcion simulada NO pudo generar el PDF con los archivos trazados.");
  process.exit(1);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
