import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../next.config";
import { PDF_FONT, PDF_ROUTE_KEY, REQUIRED_FONT_FILES, STANDARD_FONT_FILE } from "@/lib/pdf/fonts";

const root = path.resolve(import.meta.dirname, "../..");

/** Carpeta js/ de pdfkit tal como la ve @react-pdf/renderer (pnpm: node_modules/.pnpm/pdfkit@x/node_modules/pdfkit). */
function pdfkitJsDir(): string {
  const fromRenderer = createRequire(createRequire(path.join(root, "package.json")).resolve("@react-pdf/renderer"));
  // pdfkit no expone package.json en "exports": se resuelve su entrada (js/pdfkit.js) y se toma su carpeta.
  return path.dirname(realpathSync(fromRenderer.resolve("pdfkit")));
}

describe("fuentes del PDF (evita el error MODULE_NOT_FOUND de standard-fonts/Helvetica.cjs en Vercel)", () => {
  it("la plantilla solo usa fuentes estandar conocidas y siempre via PDF_FONT", () => {
    const src = readFileSync(path.join(root, "src/lib/pdf/quote-template.tsx"), "utf8");
    const families = [...src.matchAll(/fontFamily:\s*([^,}\s]+)/g)].map((m) => m[1]);
    expect(families.length).toBeGreaterThan(0);
    for (const f of families) expect(f, `fontFamily debe usar PDF_FONT, no un literal: ${f}`).toMatch(/^PDF_FONT\.(regular|bold)$/);
    for (const name of Object.values(PDF_FONT)) expect(STANDARD_FONT_FILE[name], `sin archivo para ${name}`).toBeTruthy();
  });

  it.each(REQUIRED_FONT_FILES)("pdfkit trae %s y se puede cargar", (file) => {
    const full = path.join(pdfkitJsDir(), file);
    expect(existsSync(full), `no se encontro ${full}`).toBe(true);
    const mod = createRequire(import.meta.url)(full);
    expect(JSON.stringify(mod).length).toBeGreaterThan(1000);
  });

  it("next.config incluye los archivos de pdfkit y el logo en la funcion del PDF", () => {
    const patterns = (config.outputFileTracingIncludes ?? {})[PDF_ROUTE_KEY];
    expect(patterns, `falta outputFileTracingIncludes["${PDF_ROUTE_KEY}"]`).toBeTruthy();
    const matched = new Set<string>();
    for (const p of patterns!) for (const f of globSync(p, { cwd: root })) matched.add(realpathSync(path.join(root, f)));
    for (const file of REQUIRED_FONT_FILES) {
      const real = realpathSync(path.join(pdfkitJsDir(), file));
      expect(matched.has(real), `ningun patron de outputFileTracingIncludes cubre ${file}`).toBe(true);
    }
    expect(matched.has(realpathSync(path.join(root, "public/logo-esc.png"))), "el logo debe estar incluido").toBe(true);
  });

  it("pdfkit y @react-pdf/renderer no se empaquetan (serverExternalPackages)", () => {
    expect(config.serverExternalPackages).toEqual(expect.arrayContaining(["@react-pdf/renderer", "pdfkit"]));
  });

  it("la ruta del PDF corre en Node.js y su clave coincide con la carpeta de la ruta", () => {
    const routeFile = path.join(root, "src/app/api/pdf/[requestId]/route.ts");
    expect(existsSync(routeFile)).toBe(true);
    expect(PDF_ROUTE_KEY).toBe("/api/pdf/[requestId]");
    expect(readFileSync(routeFile, "utf8")).toMatch(/export const runtime = "nodejs"/);
  });

  it("pnpm build verifica el trazado despues de compilar", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("scripts/verify-pdf-trace.mjs");
  });
});
