import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Desde la migracion 0015 (quote_pdf_min_choices) hay dos caminos entre quote_items y quote_requests,
// asi que Supabase (PostgREST) exige indicar la llave: quote_items_request_id_fkey.
const SRC = path.resolve(import.meta.dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

describe("consultas entre partidas y solicitudes", () => {
  it("todo embed quote_items <-> quote_requests indica la llave foranea", () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      let from = "";
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(/\.from\("([a-z_]+)"\)/);
          if (m) from = m[1];
          // Solo es ambiguo entre esas dos tablas: quote_requests embebido (desde partidas) o partidas desde solicitudes.
          const ambiguous = /\bquote_requests(!inner)?\(/.test(line) || (from === "quote_requests" && /\bquote_items(!inner)?\(/.test(line));
          if (ambiguous) bad.push(`${path.relative(SRC, f)}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
