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
      await rpc(w.buyer1, "update public.customers set tipo='cliente' where id=$1", [c]);
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
      // La partida ganada registra la venta, pero sin factura no lo vuelve cliente.
      expect((await rpc(w.seller1, "select tipo from public.customers where id=$1", [w.customerId])).rows[0].tipo).toBe("prospecto");
      expect(after.rows[0]).toEqual({ cot: true, ped: true });
    });

    it("si ya habia un registro abierto con ese prospecto, la solicitud se liga a el (no duplica)", async () => {
      await rpc(w.buyer1, "update public.customers set tipo='prospecto' where id=$1", [w.customerId]);
      const open = await newEntry(w.seller1, w.ids.s1, w.customerId);
      const { request } = await newQuotedItem(w);
      const linked = await rpc(w.seller1, "select request_id from public.bitacora where id=$1", [open]);
      expect(linked.rows[0].request_id).toBe(request);
    });

    it("el prospecto compra con factura en una sucursal (domicilio de entrega): sale de prospeccion como cliente", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      const folio = "P" + Math.floor(Math.random() * 1e8);
      const datos = JSON.stringify({ folio, uuid: randomUUID(), customer_id: c, pago: "contado", total: 800, moneda: "MXN", entrega_nombre: "Planta 2", entrega_direccion: "Calle Falsa 123 " + folio, lineas: [{ clave: null, descripcion: "Guante", cantidad: 3 }] });
      const r = (await rpc(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos])).rows[0].r;
      expect(r.sucursal_id).toBeTruthy();
      const b = (await rpc(w.seller1, "select resultado, fecha_pedido is not null as ped, monto_venta::numeric as monto from public.bitacora where id=$1", [id])).rows[0];
      expect(b).toMatchObject({ resultado: "ganada", ped: true });
      expect((await rpc(w.seller1, "select tipo from public.customers where id=$1", [c])).rows[0].tipo).toBe("cliente");
      const ev = await rpc(w.seller1, "select nota from public.bitacora_eventos where bitacora_id=$1 and tipo='estatus_cliente'", [id]);
      expect(ev.rows.map((x) => x.nota).join("|")).toMatch(new RegExp(`primera venta \\(factura ${folio}\\)`));
    });

    it("el vendedor no marca a mano 'Ya es cliente' ni 'Venta cerrada'; solo con factura", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      expect(await failure(rpc(w.seller1, "update public.customers set tipo='cliente' where id=$1", [c]))).toMatch(/solo al subir el PDF/);
      expect(await failure(rpc(w.seller1, "update public.bitacora set resultado='ganada' where id=$1", [id]))).toMatch(/solo al subir el PDF/);
      await rpc(w.seller1, "insert into public.ventas (customer_id, monto, pago) values ($1, 100, 'contado')", [c]);
      expect((await rpc(w.seller1, "select resultado from public.bitacora where id=$1", [id])).rows[0].resultado).toBe("abierta");
      // Si el comprador lo corrige en su catalogo, se cierra
      await rpc(w.buyer1, "update public.customers set tipo='cliente' where id=$1", [c]);
      expect((await rpc(w.seller1, "select resultado from public.bitacora where id=$1", [id])).rows[0].resultado).toBe("ganada");
    });

    it("prospecto con nombre popular: la factura salio con otro nombre y se une con esa venta", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      const folio = "U" + Math.floor(Math.random() * 1e8);
      const datos = JSON.stringify({ folio, uuid: randomUUID(), nombre: "RAZON SOCIAL " + folio + " SA DE CV", razon_social: "RAZON SOCIAL " + folio + " SA DE CV", rfc: "EKU9003173C9", pago: "contado", total: 900, moneda: "MXN", lineas: [{ clave: null, descripcion: "Guante", cantidad: 1 }] });
      const r = (await rpc(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos])).rows[0].r;
      expect(r.cliente_nuevo).toBe(true);
      expect((await rpc(w.seller1, "select resultado from public.bitacora where id=$1", [id])).rows[0].resultado).toBe("abierta");
      // Otro vendedor no puede
      expect(await failure(rpc(w.seller2, "select public.prospecto_unir_cliente($1,$2)", [id, r.customer_id]))).toMatch(/Solo el vendedor/);
      await rpc(w.seller1, "select public.prospecto_unir_cliente($1,$2)", [id, r.customer_id]);
      const b = (await rpc(w.seller1, "select resultado, fecha_pedido is not null as ped from public.bitacora where id=$1", [id])).rows[0];
      expect(b).toEqual({ resultado: "ganada", ped: true });
      const venta = (await rpc(w.seller1, "select customer_id from public.ventas where id=$1", [r.venta_id])).rows[0];
      expect(venta.customer_id).toBe(c);
      const cli = (await rpc("postgres", "select tipo, razon_social, rfc from public.customers where id=$1", [c])).rows[0];
      expect(cli).toMatchObject({ tipo: "cliente", razon_social: "RAZON SOCIAL " + folio + " SA DE CV", rfc: "EKU9003173C9" });
      const dup = (await rpc("postgres", "select activo, unido_a from public.customers where id=$1", [r.customer_id])).rows[0];
      expect(dup).toEqual({ activo: false, unido_a: c });
      const ev = await rpc(w.seller1, "select nota from public.bitacora_eventos where bitacora_id=$1 and tipo='estatus_cliente'", [id]);
      expect(ev.rows.map((x) => x.nota).join("|")).toMatch(/se unió con "RAZON SOCIAL/);
      // La siguiente factura con ese RFC ya cae en el prospecto
      expect((await rpc("postgres", "select public.cliente_de_factura('EKU9003173C9', null, null) as id")).rows[0].id).toBe(c);
    });

    it("prospecto en pausa: no corre el seguimiento; al reanudar regresa la fecha", async () => {
      const c = await newCustomer(w.seller1, w.ids.s1);
      const id = await newEntry(w.seller1, w.ids.s1, c);
      await rpc(w.seller1, "update public.bitacora set proximo_seguimiento=current_date - 3 where id=$1", [id]);
      expect(await failure(rpc(w.seller2, "select public.bitacora_pausa($1, true, 'x')", [id]))).toMatch(/Solo el vendedor/);
      await rpc(w.seller1, "select public.bitacora_pausa($1, true, 'Varios intentos sin respuesta')", [id]);
      let b = (await rpc(w.seller1, "select pausada_at, pausa_motivo, proximo_seguimiento, pausa_seguimiento from public.bitacora where id=$1", [id])).rows[0];
      expect(b.pausada_at).not.toBeNull();
      expect(b.pausa_motivo).toBe("Varios intentos sin respuesta");
      expect(b.proximo_seguimiento).toBeNull();
      const ev = (await rpc(w.seller1, "select nota from public.bitacora_eventos where bitacora_id=$1 and tipo='comentario' order by created_at desc limit 1", [id])).rows[0];
      expect(ev.nota).toMatch(/^En pausa: Varios intentos/);
      // La jefa la reanuda: como la fecha ya paso, queda para hoy
      await rpc(jefa, "select public.bitacora_pausa($1, false)", [id]);
      b = (await rpc(w.seller1, "select pausada_at, proximo_seguimiento = current_date as hoy from public.bitacora where id=$1", [id])).rows[0];
      expect(b.pausada_at).toBeNull();
      expect(b.hoy).toBe(true);
      // Si en pausa le ponen fecha de seguimiento, se reanuda solo
      await rpc(w.seller1, "select public.bitacora_pausa($1, true)", [id]);
      await rpc(w.seller1, "update public.bitacora set proximo_seguimiento=current_date + 5 where id=$1", [id]);
      expect((await rpc(w.seller1, "select pausada_at from public.bitacora where id=$1", [id])).rows[0].pausada_at).toBeNull();
    });

    it("la jefa sube una factura a nombre de un vendedor; el vendedor no puede", async () => {
      const folio = "J" + Math.floor(Math.random() * 1e8);
      const datos = JSON.stringify({ folio, uuid: randomUUID(), nombre: "CLIENTE JEFA " + folio, pago: "contado", total: 500, moneda: "MXN", lineas: [{ clave: null, descripcion: "Guante", cantidad: 2 }] });
      expect(await failure(rpc(w.seller1, "select public.venta_desde_factura_por($1::jsonb, $2)", [datos, w.ids.s2]))).toMatch(/Solo la jefa/);
      expect(await failure(rpc(jefa, "select public.venta_desde_factura_por($1::jsonb, $2)", [datos, w.ids.b1]))).toMatch(/Vendedor no encontrado/);
      const r = (await rpc(jefa, "select public.venta_desde_factura_por($1::jsonb, $2) as r", [datos, w.ids.s1])).rows[0].r;
      const v = (await rpc(w.seller1, "select vendedor_id, factura from public.ventas where id=$1", [r.venta_id])).rows[0];
      expect(v).toMatchObject({ vendedor_id: w.ids.s1, factura: folio });
      expect((await rpc(w.seller1, "select count(*)::int n from public.notifications where user_id=$1 and tipo='venta_por_jefa' and ref_id=$2", [w.ids.s1, r.venta_id])).rows[0].n).toBe(1);
      // Una venta normal de la jefa sigue quedando a su nombre
      const datos2 = JSON.stringify({ folio: folio + "B", uuid: randomUUID(), nombre: "CLIENTE JEFA B " + folio, pago: "contado", total: 100, moneda: "MXN", lineas: [{ clave: null, descripcion: "X", cantidad: 1 }] });
      const r2 = (await rpc(jefa, "select public.venta_desde_factura($1::jsonb) as r", [datos2])).rows[0].r;
      expect((await rpc(jefa, "select vendedor_id from public.ventas where id=$1", [r2.venta_id])).rows[0].vendedor_id).toBe(jefaId);
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
