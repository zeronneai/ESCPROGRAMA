import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { as, failure, type Actor } from "./helpers";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

async function user(rol: string): Promise<{ id: string; a: Actor }> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1,$2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, `U ${rol}`, `${id}@esc.test`, rol]);
  return { id, a: { id, role: "authenticated" } };
}

export function riesgosSuite() {
  describe("analisis de riesgo", () => {
    it("jefes de area crean el suyo; ISO, gerente y CEO ven todos; vendedor no", async () => {
      const [jefa, comp, vend, iso, ger, ceo] = await Promise.all(["jefe_ventas", "comprador", "vendedor", "coordinador_iso", "gerente", "ceo"].map(user));
      const acts = JSON.stringify([{ id: "a1", actividad: "Cotizar", modos: [{ id: "m1", modo: "Precio mal", severidad: 4, ocurrencia: 3, deteccion: 2 }] }]);
      const r = (await q(jefa.a, "insert into public.riesgo_analisis (proceso, actividades) values ('Ventas', $1::jsonb) returning id, folio, area, autor_nombre", [acts])).rows[0];
      expect(r.folio).toMatch(/^AR-\d{3}$/);
      expect(r).toMatchObject({ area: "jefe_ventas", autor_nombre: "U jefe_ventas" });
      expect(await failure(q(vend.a, "insert into public.riesgo_analisis (proceso) values ('X')"))).toBeTruthy();
      // El comprador no ve ni edita el de ventas
      expect((await q(comp.a, "select id from public.riesgo_analisis where id=$1", [r.id])).rows.length).toBe(0);
      expect((await q(comp.a, "update public.riesgo_analisis set proceso='Y' where id=$1 returning id", [r.id])).rows.length).toBe(0);
      for (const v of [iso, ger, ceo]) expect((await q(v.a, "select id from public.riesgo_analisis where id=$1", [r.id])).rows.length).toBe(1);
      // ISO puede editar; la gerente solo leer
      expect((await q(iso.a, "update public.riesgo_analisis set proceso='Ventas y cotizacion' where id=$1 returning editado_nombre", [r.id])).rows[0].editado_nombre).toBe("U coordinador_iso");
      expect((await q(ger.a, "update public.riesgo_analisis set proceso='Z' where id=$1 returning id", [r.id])).rows.length).toBe(0);
      // No se borra
      expect(await failure(q(jefa.a, "delete from public.riesgo_analisis where id=$1", [r.id]))).toBeTruthy();
      expect(await failure(q(jefa.a, "insert into public.riesgo_analisis (proceso, actividades) values ('X', '{}'::jsonb)"))).toBeTruthy();
    });
  });
}
