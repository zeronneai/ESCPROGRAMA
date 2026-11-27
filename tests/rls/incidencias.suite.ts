import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));
async function persona(rol: string, nombre: string): Promise<Actor & { id: string }> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, nombre, `${id}@esc.test`, rol]);
  return { id, role: "authenticated" };
}
const INS = "insert into public.incidencias (tipo, variante, producto, cliente, factura, accion) values ($1,$2,'ESC-GN100 · 10 cajas','Pegatron / entrega','F100','Se repuso') returning id, firma_nombre, folio";

export function incidenciasSuite() {
  describe.skipIf(!DATABASE_URL)("Bitacora de incidencias", () => {
    it("solo el supervisor de almacen la llena (firma automatica); la ven ventas, gerencia, ISO y compras; a la 3a del mes avisa a ISO", async () => {
      const sup = await persona("supervisor_almacen", "Sup Inc");
      const iso = await persona("coordinador_iso", "ISO Inc");
      const vend = await persona("vendedor", "Vend Inc");
      const alm = await persona("almacen", "Alm Inc");
      const comp = await persona("comprador", "Comp Inc");
      expect(await failure(q(alm, INS, ["devolucion", null]))).toMatch(/row-level/);
      expect(await failure(q(sup, INS, ["producto_no_conforme", null]))).toMatch(/check/);
      const a = (await q(sup, INS, ["producto_no_conforme", "reciba"])).rows[0];
      expect(a.firma_nombre).toBe("Sup Inc");
      expect((await q(vend, "select id from public.incidencias where id=$1", [a.id])).rowCount).toBe(0);
      expect((await q(comp, "select id from public.incidencias where id=$1", [a.id])).rowCount).toBe(1);
      expect((await q(iso, "select id from public.incidencias where id=$1", [a.id])).rowCount).toBe(1);
      await q(sup, INS, ["error_carga", null]);
      await q(sup, INS, ["error_carga", null]);
      expect((await q(iso, "select * from public.incidencias_alertas where tipo='error_carga' and sac_id is null")).rowCount).toBe(0);
      const t = (await q(sup, INS, ["error_carga", null])).rows[0];
      const al = (await q(iso, "select * from public.incidencias_alertas where tipo='error_carga' and sac_id is null")).rows;
      expect(al).toHaveLength(1);
      expect((await q("postgres", "select count(*)::int as n from public.notifications where user_id=$1 and tipo='incidencia_rac'", [iso.id])).rows[0].n).toBe(1);
      // No se borra; el sup la puede cancelar
      expect((await q(sup, "update public.incidencias set cancelada_at=now() where id=$1", [t.id])).rowCount).toBe(1);
      const sac = (await q(iso, "insert into public.acciones_correctivas (solicitante, fuente, fuente_otro, descripcion) values ('ISO','otro','Bitacora de incidencias','Tres errores de carga') returning id")).rows[0].id;
      expect(await failure(q(sup, "select public.incidencia_alerta_ligar($1,$2)", [al[0].id, sac]))).toMatch(/ISO/);
      await q(iso, "select public.incidencia_alerta_ligar($1,$2)", [al[0].id, sac]);
      expect((await q(iso, "select * from public.incidencias_alertas where sac_id is null and tipo='error_carga'")).rowCount).toBe(0);
    });
  });
}
