import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld } from "./fixtures";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

async function persona(rol: string, nombre: string): Promise<Actor> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, nombre, `${id}@esc.test`, rol]);
  return { id, role: "authenticated" };
}

export function metaProspeccionSuite() {
  describe.skipIf(!DATABASE_URL)("Meta diaria de prospeccion", () => {
    it("acumula la meta de lunes a viernes desde el inicio; la jefa cambia metas y tipo; el vendedor solo se ve a si mismo", async () => {
      const w = await createWorld();
      const jefa = await persona("jefe_ventas", "Jefa Meta");
      const s1 = (w.seller1 as { id: string }).id;
      const s2 = (w.seller2 as { id: string }).id;
      // El vendedor no cambia la meta
      expect(await failure(q(w.seller1, "update public.prospeccion_config set meta_telemarketing=1 where id=1").then((r) => { if (!r.rowCount) throw new Error("sin cambio"); }))).toMatch(/sin cambio|row-level/);
      await q(jefa, "update public.prospeccion_config set meta_telemarketing=8, meta_campo=2, inicio='2026-11-16' where id=1");
      await q(jefa, "insert into public.prospeccion_vendedor (vendedor_id, tipo) values ($1,'campo')", [s2]);
      for (let i = 0; i < 3; i++) await q(w.seller1, "insert into public.bitacora (vendedor_id, customer_id, created_by) values ($1,$2,$1)", [s1, w.customerId]);
      const dias = (await q("postgres", "select public.dias_habiles('2026-11-16', public.local_today()) as d")).rows[0].d as number;
      const mio = (await q(w.seller1, "select * from public.prospeccion_avance()")).rows;
      expect(mio).toHaveLength(1);
      expect(mio[0]).toMatchObject({ tipo: "telemarketing", meta_diaria: 8, dias, requeridos: 8 * dias, registrados: 3, faltan: Math.max(8 * dias - 3, 0), hoy: 3 });
      const todos = (await q(jefa, "select * from public.prospeccion_avance()")).rows;
      expect(todos.find((r) => r.vendedor_id === s2)).toMatchObject({ tipo: "campo", meta_diaria: 2, requeridos: 2 * dias });
      expect((await q("postgres", "select public.dias_habiles('2026-11-16','2026-11-25') as d")).rows[0].d).toBe(8);
    });
  });
}
