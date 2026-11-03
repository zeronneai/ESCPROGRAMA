import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld } from "./fixtures";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

async function user(rol: string): Promise<{ id: string; a: Actor }> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1,$2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, `U ${rol}`, `${id}@esc.test`, rol]);
  return { id, a: { id, role: "authenticated" } };
}

export function minutasSuite() {
  describe.skipIf(!DATABASE_URL)("Minutas", () => {
    it("un jefe la hace, elige firmantes, se notifica y cada quien firma; nadie mas la ve", async () => {
      const w = await createWorld();
      const sup = await user("supervisor_finanzas");
      const alm = await user("supervisor_almacen");
      const ger = await user("gerente");
      expect(await failure(q(w.seller1, "insert into public.minutas (tema) values ('Junta')"))).toMatch(/row-level security/);
      const m = (await q(sup.a, `insert into public.minutas (tema, lugar, agenda, desarrollo, compromisos)
        values ('Cierre de mes', 'Sala', '[{"tema":"Cobranza","descripcion":"Revisar saldos"}]', '[{"tema":"Cobranza","desarrollo":"Se revisaron"}]',
        '[{"tema":"Cobranza","actividad":"Llamar clientes","responsable":"Vendedor 1","fecha":"2026-12-01"}]') returning id, numero, estado, created_by_nombre`)).rows[0];
      expect(m).toMatchObject({ estado: "borrador", created_by_nombre: "U supervisor_finanzas" });
      expect(m.numero).toMatch(/^MIN-\d{4}-\d{3}$/);
      expect(await failure(q(sup.a, "select public.minuta_enviar($1)", [m.id]))).toMatch(/quien debe firmar/);
      expect(await failure(q(alm.a, "select public.minuta_firmantes($1,$2::uuid[])", [m.id, [alm.id]]))).toMatch(/No autorizado/);
      await q(sup.a, "select public.minuta_firmantes($1,$2::uuid[])", [m.id, [sup.id, alm.id, w.ids.s1]]);
      expect((await q(alm.a, "select id from public.minutas where id=$1", [m.id])).rowCount).toBe(0);
      await q(sup.a, "select public.minuta_enviar($1)", [m.id]);
      expect((await q(sup.a, "update public.minutas set tema='Otro' where id=$1", [m.id])).rowCount).toBe(0);
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='minuta_firma' and ref_id=$1", [m.id])).rows[0].count)).toBe(2);
      expect((await q(alm.a, "select id from public.minutas where id=$1", [m.id])).rowCount).toBe(1);
      expect((await q(ger.a, "select id from public.minutas where id=$1", [m.id])).rowCount).toBe(1);
      expect((await q(w.seller2, "select id from public.minutas where id=$1", [m.id])).rowCount).toBe(0);
      expect(await failure(q(w.seller2, "select public.minuta_firmar($1)", [m.id]))).toMatch(/No te toca/);
      await q(alm.a, "select public.minuta_firmar($1)", [m.id]);
      expect(await failure(q(alm.a, "select public.minuta_firmar($1)", [m.id]))).toMatch(/ya la firmaste/);
      await q(w.seller1, "select public.minuta_firmar($1)", [m.id]);
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='minuta_firmada' and user_id=$1", [sup.id])).rows[0].count)).toBe(1);
      expect((await q(w.seller1, "select count(*)::int as n from public.minuta_firmas where minuta_id=$1 and firmada_at is not null", [m.id])).rows[0].n).toBe(3);
      expect((await q(sup.a, "select count(*)::int as n from public.minuta_usuarios()")).rows[0].n).toBeGreaterThan(3);
      expect((await q(w.seller1, "select count(*)::int as n from public.minuta_usuarios()")).rows[0].n).toBe(0);
    });
  });
}
