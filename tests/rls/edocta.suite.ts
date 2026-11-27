import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));
async function persona(rol: string): Promise<Actor & { id: string }> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, `n${id.slice(0, 6)}`, `${id}@esc.test`, rol]);
  return { id, role: "authenticated" };
}

export function edoCtaSuite() {
  describe.skipIf(!DATABASE_URL)("Estados de cuenta diarios", () => {
    it("lista las cuentas y cuales ya se subieron hoy (o se marcaron sin abonos)", async () => {
      const aux = await persona("aux_finanzas");
      const vend = await persona("vendedor");
      const c1 = "9" + randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "1");
      const c2 = "8" + randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "2");
      expect(await failure(q(vend, "insert into public.conciliacion_cuentas (banco, cuenta) values ('BBVA', $1)", [c1]))).toMatch(/row-level/);
      await q(aux, "insert into public.conciliacion_cuentas (banco, cuenta) values ('BBVA', $1), ('Banregio', $2)", [c1, c2]);
      const ids = (await q(aux, "select * from public.estados_cuenta_hoy()")).rows.filter((r) => [c1, c2].includes(r.cuenta));
      expect(ids.every((r) => !r.subido)).toBe(true);
      await q(aux, "select public.conciliacion_subir($1::jsonb)", [JSON.stringify({ banco: "BBVA", cuenta: c1, moneda: "MXN", abonos: [{ fecha: "2026-11-26", descripcion: `ABONO ${c1}`, monto: 10 }] })]);
      const id2 = ids.find((r) => r.cuenta === c2).id;
      expect(await failure(q(vend, "select public.estado_cuenta_sin_abonos($1)", [id2]))).toMatch(/finanzas/);
      await q(aux, "select public.estado_cuenta_sin_abonos($1)", [id2]);
      const r = (await q(aux, "select * from public.estados_cuenta_hoy()")).rows.filter((x) => [c1, c2].includes(x.cuenta));
      expect(r.find((x) => x.cuenta === c1)).toMatchObject({ subido: true, sin_abonos: false });
      expect(r.find((x) => x.cuenta === c2)).toMatchObject({ subido: true, sin_abonos: true });
      await q("postgres", "update public.conciliacion_cuentas set activo=false where cuenta in ($1,$2)", [c1, c2]);
    });
  });
}
