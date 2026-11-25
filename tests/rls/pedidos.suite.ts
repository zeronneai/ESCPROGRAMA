import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld } from "./fixtures";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

export function pedidosSuite() {
  describe.skipIf(!DATABASE_URL)("Pedidos de vendedores", () => {
    it("el vendedor pide del kardex u otro; la OC cierra los unicos y cancelarla los reabre", async () => {
      const w = await createWorld();
      const prov = (await q(w.buyer1, "insert into public.plan_proveedores (nombre, codigo, origen) values ($1,'PDV','usa') returning id", [`PROV ${randomUUID().slice(0, 6)}`])).rows[0].id;
      const clave = `PDV-${randomUUID().slice(0, 6)}`;
      await q(w.buyer1, "insert into public.plan_articulos (clave, proveedor_id, nombre, um, precio) values ($1,$2,'Guante nitrilo azul talla M','CAJA',3.5)", [clave, prov]);
      // Buscador: sin precio ni proveedor
      const b = (await q(w.seller1, "select * from public.plan_articulos_buscar($1)", ["nitrilo azul"])).rows;
      expect(b.some((r) => r.clave === clave)).toBe(true);
      expect(Object.keys(b[0])).toEqual(["clave", "nombre", "um"]);
      // Pedidos: unico y mensual del kardex, y otro
      const p1 = (await q(w.seller1, "insert into public.pedidos_vendedor (clave, descripcion, cantidad, frecuencia, estado, nota_comprador) values ($1,'Guante',10,'unica','pedido','x') returning id, estado, nota_comprador, vendedor_id", [clave])).rows[0];
      expect(p1.estado).toBe("activo");
      expect(p1.nota_comprador).toBeNull();
      expect(p1.vendedor_id).toBe((w.seller1 as { id: string }).id);
      const p2 = (await q(w.seller1, "insert into public.pedidos_vendedor (clave, descripcion, cantidad, frecuencia) values ($1,'Guante',5,'mensual') returning id", [clave])).rows[0].id;
      const p3 = (await q(w.seller1, "insert into public.pedidos_vendedor (descripcion, cantidad, frecuencia, cliente) values ('Lentes nuevos',20,'unica','Cliente X') returning id")).rows[0].id;
      expect(await failure(q(w.seller1, "insert into public.pedidos_vendedor (descripcion, cantidad, frecuencia) values ('x',1,'diaria')"))).toMatch(/check constraint/);
      // Otro vendedor no lo ve; el comprador si
      expect((await q(w.seller2, "select id from public.pedidos_vendedor where id=$1", [p1.id])).rowCount).toBe(0);
      expect((await q(w.buyer1, "select id from public.pedidos_vendedor where id in ($1,$2,$3)", [p1.id, p2, p3])).rowCount).toBe(3);
      // El vendedor no se marca como pedido
      expect(await failure(q(w.seller1, "update public.pedidos_vendedor set estado='pedido' where id=$1", [p1.id]))).toMatch(/corregir o cancelar/);
      // La OC: el unico queda pedido con folio; el mensual sigue activo
      const folio = `26PDV${randomUUID().slice(0, 4)}`;
      const oc = (await q(w.buyer1, "insert into public.plan_ocs (folio, proveedor_id, llegada_estimada) values ($1,$2,'2031-02-01') returning id", [folio, prov])).rows[0].id;
      await q(w.buyer1, "insert into public.plan_oc_lineas (oc_id, clave, cantidad) values ($1,$2,100)", [oc, clave]);
      const est = async (id: string) => (await q("postgres", "select estado, oc_folio from public.pedidos_vendedor where id=$1", [id])).rows[0];
      expect(await est(p1.id)).toEqual({ estado: "pedido", oc_folio: folio });
      expect((await est(p2)).estado).toBe("activo");
      const mios = (await q(w.seller1, "select * from public.pedidos_vendedor_mios()")).rows;
      const m1 = mios.find((r) => r.id === p1.id)!;
      expect(m1.oc_folio).toBe(folio);
      expect(String(m1.llegada_estimada)).toMatch(/2031/);
      // Ya atendido: el vendedor no lo cambia
      expect(await failure(q(w.seller1, "update public.pedidos_vendedor set cantidad=2 where id=$1", [p1.id]).then((r) => { if (!r.rowCount) throw new Error("sin cambio"); }))).toMatch(/sin cambio|atendi/);
      // Cancelar la OC lo reabre; reactivarla lo vuelve a cerrar
      await q(w.buyer1, "update public.plan_ocs set estado='cancelada' where id=$1", [oc]);
      expect((await est(p1.id)).estado).toBe("activo");
      await q(w.buyer1, "update public.plan_ocs set estado='borrador' where id=$1", [oc]);
      expect((await est(p1.id)).estado).toBe("pedido");
      // Quitar el renglon lo reabre
      await q(w.buyer1, "delete from public.plan_oc_lineas where oc_id=$1", [oc]);
      expect((await est(p1.id)).estado).toBe("activo");
      // El vendedor cancela el suyo; el comprador cierra el "otro"
      await q(w.seller1, "update public.pedidos_vendedor set estado='cancelado' where id=$1", [p2]);
      await q(w.buyer1, "update public.pedidos_vendedor set estado='pedido', oc_folio='A MANO', nota_comprador='Se pidio por correo' where id=$1", [p3]);
      expect((await est(p3)).estado).toBe("pedido");
      // Reglas del asistente: solo el comprador
      expect((await q(w.seller1, "select * from public.plan_asistente")).rowCount).toBe(0);
      await q(w.buyer1, "update public.plan_asistente set reglas='Tope 30,000 USD por OC' where id=1");
    });
  });
}
