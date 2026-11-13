import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld, newQuotedItem, type World } from "./fixtures";

let w: World;
let jefa: Actor;
let jefaId: string;
const rpc = (actor: Parameters<typeof as>[0], sql: string, params: unknown[] = []) => as(actor, (q) => q(sql, params));
const SNAP = JSON.stringify({ folio: "x", rows: [], totals: [] });

const newCustomer = async (seller: Actor, sellerId: string, tipo = "prospecto") =>
  (await rpc(seller, "insert into public.customers (nombre, tipo, giro, estado_geo, created_by) values ($1,$2,'Electronica','Chihuahua',$3) returning id", [`Bit ${randomUUID().slice(0, 8)}`, tipo, sellerId])).rows[0].id as string;
const newEntry = async (seller: Actor, sellerId: string, customer: string) =>
  (await rpc(seller, "insert into public.bitacora (vendedor_id, customer_id, necesidad, created_by) values ($1,$2,'Guantes',$1) returning id", [sellerId, customer])).rows[0].id as string;

export function bitacoraSuite() {
  describe.skipIf(!DATABASE_URL)("Bitacora de ventas/prospeccion y Jefa de ventas", () => {
    beforeAll(async () => {
      w = await createWorld();
      jefaId = randomUUID();
      await rpc("postgres", "insert into auth.users (id, email) values ($1, $2)", [jefaId, `${jefaId}@esc.test`]);
      await rpc("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,'Jefa',$2,'jefe_ventas',false)", [jefaId, `${jefaId}@esc.test`]);
      jefa = { id: jefaId, role: "authenticated" };
    });

    it("cada vendedor ve solo su bitacora; comprador y jefa ven todo; la jefa no escribe", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      expect((await rpc(w.seller2, "select id from public.bitacora where id=$1", [id])).rowCount).toBe(0);
      expect((await rpc(w.buyer1, "select id from public.bitacora where id=$1", [id])).rowCount).toBe(1);
      expect((await rpc(jefa, "select id from public.bitacora where id=$1", [id])).rowCount).toBe(1);
      expect((await rpc(jefa, "select id from public.customers where id=$1", [c])).rowCount).toBe(1);
      expect((await rpc(jefa, "update public.bitacora set necesidad='x' where id=$1", [id])).rowCount).toBe(0);
      expect(await failure(rpc(w.seller2, "insert into public.bitacora (vendedor_id, customer_id, created_by) values ($1,$2,$1)", [w.ids.s1, c]))).toMatch(/row-level security/);
    });

    it("la jefa lleva su propia bitacora y ventas, sin tocar las de los vendedores", async () => {
      const c = await newCustomer(jefa, jefaId);
      const id = await newEntry(jefa, jefaId, c);
      await rpc(jefa, "update public.bitacora set fecha_catalogo=current_date where id=$1", [id]);
      await rpc(jefa, "insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by) values ($1,'comentario','Visita',$2)", [id, jefaId]);
      expect((await rpc(w.seller1, "select id from public.bitacora where id=$1", [id])).rowCount).toBe(0);
      const v = (await rpc(jefa, "insert into public.ventas (customer_id, fecha, monto, pago) values ($1, current_date, 1500, 'contado') returning id, vendedor_id", [c])).rows[0];
      expect(v.vendedor_id).toBe(jefaId);
      await rpc(jefa, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1,'Guante nitrilo',10)", [v.id]);
      expect((await rpc(w.seller1, "select id from public.ventas where id=$1", [v.id])).rowCount).toBe(0);
      // La venta de un vendedor sigue siendo solo suya.
      const c2 = await newCustomer(w.seller1, w.ids.s1, "cliente");
      const v2 = (await rpc(w.seller1, "insert into public.ventas (customer_id, fecha, monto, pago) values ($1, current_date, 900, 'contado') returning id", [c2])).rows[0].id;
      expect((await rpc(jefa, "update public.ventas set monto=1 where id=$1", [v2])).rowCount).toBe(0);
      expect(await failure(rpc(jefa, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1,'x',1)", [v2]))).toMatch(/row-level security/);
      expect(await failure(rpc(jefa, "insert into public.bitacora (vendedor_id, customer_id, created_by) values ($1,$2,$3)", [w.ids.s1, c2, jefaId]))).toMatch(/row-level security/);
    });

    it("cada etapa capturada y cada comentario quedan como evento", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      await rpc(w.seller1, "update public.bitacora set fecha_catalogo=current_date, porcentaje_cobranza=50 where id=$1", [id]);
      await rpc(w.seller1, "insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by) values ($1,'comentario','Llamé, pidió muestra',$2)", [id, w.ids.s1]);
      expect(await failure(rpc(w.seller1, "insert into public.bitacora_eventos (bitacora_id, tipo, created_by) values ($1,'etapa',$2)", [id, w.ids.s1]))).toMatch(/row-level security/);
      expect(await failure(rpc(jefa, "insert into public.bitacora_eventos (bitacora_id, tipo, nota, created_by) values ($1,'comentario','x',$2)", [id, jefaId]))).toMatch(/row-level security/);
      const ev = await rpc(w.seller1, "select tipo, etapa from public.bitacora_eventos where bitacora_id=$1 order by created_at, tipo", [id]);
      expect(ev.rows).toEqual(expect.arrayContaining([
        { tipo: "alta", etapa: null }, { tipo: "etapa", etapa: "fecha_catalogo" }, { tipo: "etapa", etapa: "cobranza" }, { tipo: "comentario", etapa: null },
      ]));
      expect(await failure(rpc("postgres", "delete from public.bitacora_eventos where bitacora_id=$1", [id]))).toMatch(/inmutable/);
    });

    it("convertir el prospecto a cliente queda en la bitacora del registro", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      await rpc(w.seller1, "update public.customers set tipo='cliente' where id=$1", [c]);
      const ev = await rpc(w.seller1, "select nota from public.bitacora_eventos where bitacora_id=$1 and tipo='estatus_cliente'", [id]);
      expect(ev.rows[0].nota).toMatch(/convertido a cliente/);
    });

    it("el portal llena la prospeccion (cliente prospecto): solicitud, cotizacion y partida ganada, y registra la venta", async () => {
      await rpc(w.buyer1, "update public.customers set tipo='prospecto' where id=$1", [w.customerId]);
      const { request, item } = await newQuotedItem(w);
      const b = await rpc(w.seller1, "select id, fecha_solicitud_compras is not null as sol, fecha_cotizacion, origen, necesidad from public.bitacora where request_id=$1", [request]);
      expect(b.rows).toHaveLength(1);
      expect(b.rows[0]).toMatchObject({ sol: true, fecha_cotizacion: null, origen: "portal", necesidad: "Producto de prueba" });
      await rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]);
      await rpc(w.seller1, "select * from public.issue_quote($1,'correo',null,null,$2::jsonb)", [request, SNAP]);
      await rpc(w.seller1, "select public.set_item_outcome($1,'ganada',null,null,null)", [item]);
      const after = await rpc(w.seller1, "select fecha_cotizacion is not null as cot, fecha_pedido is not null as ped from public.bitacora where request_id=$1", [request]);
      const venta = await rpc(w.seller1, "select v.origen, v.monto > 0 as monto, (select count(*)::int from public.venta_lineas l where l.venta_id=v.id) as lineas from public.ventas v where v.request_id=$1", [request]);
      expect(venta.rows).toEqual([{ origen: "portal", monto: true, lineas: 1 }]);
      expect((await rpc(w.seller1, "select tipo from public.customers where id=$1", [w.customerId])).rows[0].tipo).toBe("cliente");
      expect(after.rows[0]).toEqual({ cot: true, ped: true });
    });

    it("si ya habia un registro abierto con ese prospecto, la solicitud se liga a el (no duplica)", async () => {
      await rpc(w.buyer1, "update public.customers set tipo='prospecto' where id=$1", [w.customerId]);
      const open = await newEntry(w.seller1, w.ids.s1, w.customerId);
      const { request } = await newQuotedItem(w);
      const linked = await rpc(w.seller1, "select request_id from public.bitacora where id=$1", [open]);
      expect(linked.rows[0].request_id).toBe(request);
    });

    it("la jefa ve solicitudes y precios de todos los vendedores, pero no costos", async () => {
      const { request, item } = await newQuotedItem(w, "Producto jefa", "100", {}, w.seller2);
      expect((await rpc(jefa, "select id from public.quote_requests where id=$1", [request])).rowCount).toBe(1);
      expect((await rpc(jefa, "select item_id from public.item_quotes where item_id=$1", [item])).rowCount).toBe(1);
      expect((await rpc(jefa, "select item_id from public.item_costs where item_id=$1", [item])).rowCount).toBe(0);
      expect((await rpc(jefa, "select id from public.profiles where id=$1", [w.ids.s2])).rowCount).toBe(1);
    });
  });
}
