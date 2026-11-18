import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld, newQuotedItem } from "./fixtures";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

export function planeacionSuite() {
  describe.skipIf(!DATABASE_URL)("Planeacion de compras", () => {
    it("solo el comprador ve y maneja la planeacion; recibir guarda la fecha", async () => {
      const w = await createWorld();
      const nombre = `TSINGAO ${randomUUID().slice(0, 6)}`;
      // El vendedor no puede crear ni ver nada
      expect(await failure(q(w.seller1, "insert into public.plan_proveedores (nombre, codigo, origen) values ($1,'JGH','china')", [nombre]))).toMatch(/row-level security/);
      const prov = (await q(w.buyer1, "insert into public.plan_proveedores (nombre, codigo, origen, entrega_dias) values ($1,'JGH','china',120) returning id", [nombre])).rows[0].id;
      expect((await q(w.seller1, "select id from public.plan_proveedores where id=$1", [prov])).rowCount).toBe(0);
      expect(await failure(q(w.buyer1, "update public.plan_proveedores set codigo='jg1' where id=$1", [prov]))).toMatch(/check constraint/);
      const clave = `ESC-T${randomUUID().slice(0, 6)}`;
      await q(w.buyer1, "insert into public.plan_articulos (clave, proveedor_id, nombre, empaque, cbm_empaque, precio) values ($1,$2,'Cinta',54,0.04,0.46)", [clave, prov]);
      const corte = (await q(w.buyer1, "insert into public.plan_cortes (fecha, fuente) values ('2031-01-01','prueba') returning id")).rows[0].id;
      await q(w.buyer1, "insert into public.plan_existencias (corte_id, clave, existencia) values ($1,$2,100)", [corte, clave]);
      await q(w.buyer1, "insert into public.plan_historial (clave, mes, venta, dias_stock, dias) values ($1,'2030-12-01',30,31,31)", [clave]);
      expect(await failure(q(w.buyer1, "insert into public.plan_historial (clave, mes) values ($1,'2030-12-15')", [clave]))).toMatch(/check constraint/);
      expect((await q(w.seller1, "select * from public.plan_existencias where corte_id=$1", [corte])).rowCount).toBe(0);
      // OC: borrador -> recibida pone la fecha; regresar la quita
      const folio = `26JGH${randomUUID().slice(0, 4)}`;
      const oc = (await q(w.buyer1, "insert into public.plan_ocs (folio, proveedor_id, fecha) values ($1,$2,'2031-01-02') returning id, estado, recibida_fecha", [folio, prov])).rows[0];
      expect(oc.estado).toBe("borrador");
      expect(oc.recibida_fecha).toBeNull();
      await q(w.buyer1, "insert into public.plan_oc_lineas (oc_id, clave, cantidad, precio) values ($1,$2,540,0.46)", [oc.id, clave]);
      expect(await failure(q(w.buyer1, "insert into public.plan_oc_lineas (oc_id, clave, cantidad) values ($1,$2,0)", [oc.id, `${clave}x`]))).toMatch(/check constraint/);
      expect(await failure(q(w.buyer1, "insert into public.plan_ocs (folio, proveedor_id) values ($1,$2)", [folio, prov]))).toMatch(/duplicate key/);
      expect((await q(w.seller1, "update public.plan_ocs set estado='cancelada' where id=$1", [oc.id])).rowCount).toBe(0);
      const rec = (await q(w.buyer1, "update public.plan_ocs set estado='recibida' where id=$1 returning recibida_fecha", [oc.id])).rows[0];
      expect(rec.recibida_fecha).not.toBeNull();
      const back = (await q(w.buyer1, "update public.plan_ocs set estado='embarcada' where id=$1 returning recibida_fecha", [oc.id])).rows[0];
      expect(back.recibida_fecha).toBeNull();
      expect((await q(w.seller1, "select id from public.plan_oc_lineas where oc_id=$1", [oc.id])).rowCount).toBe(0);
      // Datos para la Purchase Order
      await q(w.buyer1, "update public.plan_proveedores set razon_social='RIZHAO ESHINE TRADING CO.,LTD', contacto='Terry', enviar_a='Port of Export in China' where id=$1", [prov]);
    });

    it("la gerente ve las cotizaciones y sus costos, pero no el proveedor ni lo del comprador", async () => {
      const w = await createWorld();
      const gid = randomUUID();
      await q("postgres", "insert into auth.users (id, email) values ($1,$2)", [gid, `${gid}@esc.test`]);
      await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,'Gerente',$2,'gerente',false)", [gid, `${gid}@esc.test`]);
      const ger: Actor = { id: gid, role: "authenticated" };
      const x = await newQuotedItem(w, "Guante prueba", "123.45");
      await q("postgres", "insert into public.item_sourcing (item_id, proveedor, link_producto, numero_parte) values ($1,'Proveedor secreto','https://x.test/p','P-1')", [x.item]);
      expect((await q(ger, "select id from public.quote_requests where id=$1", [x.request])).rowCount).toBe(1);
      expect((await q(ger, "select item_id from public.item_quotes where item_id=$1", [x.item])).rowCount).toBe(1);
      const c = (await q(ger, "select * from public.costos_solicitud($1)", [x.request])).rows;
      expect(c).toHaveLength(1);
      expect(Number(c[0].costo)).toBeCloseTo(123.45, 2);
      expect(Object.keys(c[0])).not.toContain("proveedor");
      // Lo del comprador sigue cerrado
      const cerrado = async (sql: string) => {
        const r = await q(ger, sql, [x.item]).catch(() => ({ rowCount: 0 }));
        expect(r.rowCount).toBe(0);
      };
      await cerrado("select * from public.item_sourcing where item_id=$1");
      await cerrado("select * from public.item_costs where item_id=$1");
      // El vendedor no ve costos
      expect((await q(w.seller1, "select * from public.costos_solicitud($1)", [x.request])).rowCount).toBe(0);
      expect((await q(w.buyer1, "select * from public.costos_solicitud($1)", [x.request])).rowCount).toBe(1);
    });
  });
}
