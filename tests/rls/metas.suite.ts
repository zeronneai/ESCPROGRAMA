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

export function metasSuite() {
  describe.skipIf(!DATABASE_URL)("Metas mensuales de venta", () => {
    it("avance en % con las ventas del mes; montos solo para jefa/gerente o el propio vendedor", async () => {
      const w = await createWorld();
      const jefa = await persona("jefe_ventas", "Jefa Metas");
      const ger = await persona("gerente", "Gerente Metas");
      const s1 = (w.seller1 as { id: string }).id;
      const s2 = (w.seller2 as { id: string }).id;
      const tag = randomUUID().slice(0, 5);
      expect(await failure(q(w.seller1, "insert into public.metas_venta (nombre, meta) values ('x', 10)"))).toMatch(/row-level/);
      await q(jefa, "insert into public.metas_venta (nombre, vendedor_id, meta) values ($1,$2,1000000),($3,$4,500000)", [`M1 ${tag}`, s1, `M2 ${tag}`, s2]);
      const pulso0 = (await q("postgres", "select at from public.ventas_pulso")).rows[0].at;
      await q(w.seller1, "insert into public.ventas (customer_id, monto, moneda, pago) values ($1,300000,'MXN','contado')", [w.customerId]);
      const usd = (await q(w.seller1, "insert into public.ventas (customer_id, monto, moneda, pago) values ($1,1000,'USD','contado') returning id", [w.customerId])).rows[0].id;
      await q("postgres", "update public.ventas set tipo_cambio=20 where id=$1", [usd]);
      expect((await q("postgres", "select at from public.ventas_pulso")).rows[0].at).not.toEqual(pulso0);
      const mio = (await q(w.seller1, "select * from public.metas_ventas_avance()")).rows;
      const m1 = mio.find((r) => r.nombre === `M1 ${tag}`)!;
      expect(Number(m1.pct)).toBe(32);
      expect(Number(m1.equipo_pct)).toBeGreaterThan(0);
      expect(Number(m1.vendido)).toBe(320000);
      const m2 = mio.find((r) => r.nombre === `M2 ${tag}`)!;
      expect(m2.vendido).toBeNull();
      expect(m2.meta).toBeNull();
      const g = (await q(ger, "select * from public.metas_ventas_avance()")).rows.find((r) => r.nombre === `M2 ${tag}`)!;
      expect(Number(g.meta)).toBe(500000);
      await q(jefa, "update public.metas_venta set estado='pausada' where nombre=$1", [`M2 ${tag}`]);
      expect((await q(ger, "select * from public.metas_ventas_avance()")).rows.some((r) => r.nombre === `M2 ${tag}`)).toBe(false);
      expect((await q(ger, "select count(*)::int n from public.metas_venta where nombre like 'Casa Local'")).rows[0].n).toBe(1);
    });
  });
}
