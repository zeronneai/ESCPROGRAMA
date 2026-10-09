import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../supabase");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

// Estas migraciones ya estan instaladas en Supabase (via instalar-todo.sql): no se tocan.
const FROZEN: Record<string, string> = {
  "migrations/0001_core.sql": "3eca8cbd1dcbf89ee1344188c6fb9b4b8f3d734f90cc7276080191cca0faca2a",
  "migrations/0002_guards.sql": "ee185df17e2278a002e7c0ac4f03e1c975d102c9d71d1a00f5b7425b2f4af8f9",
  "migrations/0003_rpc.sql": "b71396f9df852708a22ceead83aab9406b19bc13d12dce7df5626c51d30cdec8",
  "migrations/0004_rls.sql": "fe88174aca4adeb9bd7a0084ae8f63525da9ef8af94e7aab3dfc05d741a71bac",
  "migrations/0005_storage.sql": "ce6999a27d26deaf492efc20bfc4f74f580d1f12a50d4758750ce11a4417269a",
  "instalar-todo.sql": "988f7689092672fdc17ffd657c0a2c27e8e559b408186361b67b0ac053dfd550",
};

describe("migraciones", () => {
  it.each(Object.entries(FROZEN))("%s no cambia (ya esta instalada)", (file, hash) => {
    expect(sha(path.join(root, file))).toBe(hash);
  });

  it("cada migracion nueva (0006 en adelante) tiene su copia identica en actualizaciones/", () => {
    const nuevas = readdirSync(path.join(root, "migrations")).filter((f) => /^\d{4}_.+\.sql$/.test(f) && Number(f.slice(0, 4)) >= 6);
    for (const f of nuevas) {
      const copy = path.join(root, "actualizaciones", f);
      expect(readFileSync(copy, "utf8"), `falta o difiere supabase/actualizaciones/${f}`).toBe(
        readFileSync(path.join(root, "migrations", f), "utf8"),
      );
    }
  });

  it("las actualizaciones no tienen archivos huerfanos", () => {
    const mig = new Set(readdirSync(path.join(root, "migrations")));
    for (const f of readdirSync(path.join(root, "actualizaciones")).filter((x) => x.endsWith(".sql"))) {
      expect(mig.has(f), `${f} no existe en migrations/`).toBe(true);
    }
  });
});
