import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure } from "./helpers";
import {
  FACTORS, createWorld, currentFactors, dueIn48, expireQuote, newPendingItem, newQuotedItem, quotePayload, respond, type World,
} from "./fixtures";

let w: World;

const rpc = (actor: Parameters<typeof as>[0], sql: string, params: unknown[] = []) => as(actor, (q) => q(sql, params));
const itemRow = async (id: string) =>
  (await as("postgres", (q) => q("select estado, first_response_at from public.quote_items where id=$1", [id]))).rows[0];

export function fase4Suite() {
  describe.skipIf(!DATABASE_URL)("Fase 4: vigencia, revisiones, resultados, aclaraciones, PDF y abastecimiento", () => {
  beforeAll(async () => {
    w = await createWorld();
  });

  describe("vigencia de 15 dias", () => {
    it("valid_until = quoted_at + 15 dias, calculado por la BD (no por el cliente)", async () => {
      const { item } = await newQuotedItem(w);
      const r = await as(w.seller1, (q) =>
        q("select extract(epoch from (valid_until - quoted_at))/86400 as dias from public.item_quotes where item_id=$1", [item]));
      expect(Number(r.rows[0].dias)).toBeCloseTo(15, 3);
    });

    it("el comprador configura los dias; aplica a cotizaciones nuevas; el vendedor no puede cambiarlo", async () => {
      expect((await rpc(w.seller1, "update public.app_settings set vigencia_dias=1")).rowCount).toBe(0);
      await rpc(w.buyer1, "update public.app_settings set vigencia_dias=10");
      const { item } = await newQuotedItem(w, "Producto vigencia 10");
      const r = await as("postgres", (q) => q("select extract(epoch from (valid_until - quoted_at))/86400 as dias from public.item_quotes where item_id=$1", [item]));
      expect(Number(r.rows[0].dias)).toBeCloseTo(10, 3);
      await rpc(w.buyer1, "update public.app_settings set vigencia_dias=15");
    });

    it("no se puede enviar al cliente ni elegir precio con la vigencia vencida", async () => {
      const { item } = await newQuotedItem(w);
      await expireQuote(item);
      expect(await failure(rpc(w.seller1, "select public.mark_item_dispatched($1,2)", [item]))).toMatch(/Vigencia vencida/);
      expect(await failure(rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]))).toMatch(/Vigencia vencida/);
    });

    it("el bloqueo item_quotes_locked sigue activo tras el respaldo de la migracion 0007", async () => {
      const r = await as("postgres", (q) => q("select tgenabled from pg_trigger where tgrelid='public.item_quotes'::regclass and tgname='item_quotes_locked'"));
      expect(r.rows[0].tgenabled).toBe("O");
    });
  });

  describe("revisiones versionadas", () => {
    it("solo se pide actualizacion con la vigencia vencida, una vez, y solo el vendedor dueno", async () => {
      const { item } = await newQuotedItem(w);
      expect(await failure(rpc(w.seller1, "select public.request_item_update($1,'x',$2)", [item, dueIn48()]))).toMatch(/aun esta vigente/);
      await expireQuote(item);
      expect(await failure(rpc(w.seller2, "select public.request_item_update($1,'x',$2)", [item, dueIn48()]))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.buyer1, "select public.request_item_update($1,'x',$2)", [item, dueIn48()]))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.seller1, "select public.request_item_update($1,'x',$2)", [item, new Date(Date.now() + 3600_000).toISOString()]))).toMatch(/fuera del rango/);
      await rpc(w.seller1, "select public.request_item_update($1,'Cliente pide precio vigente',$2)", [item, dueIn48()]);
      expect((await itemRow(item)).estado).toBe("actualizacion_solicitada");
      expect(await failure(rpc(w.seller1, "select public.request_item_update($1,'x',$2)", [item, dueIn48()]))).toMatch(/Solo se puede pedir/);
      const n = await rpc(w.buyer1, "select count(*)::int n from public.notifications where tipo='actualizacion_solicitada' and ref_id is not null and user_id=$1", [w.ids.b1]);
      expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    it("confirmar sin cambios crea v2 con los mismos costos y 15 dias nuevos; la v1 queda intacta", async () => {
      const { item } = await newQuotedItem(w, "Producto confirmar", "250");
      const before = (await as("postgres", (q) => q("select price_1::text, valid_until from public.item_quotes where item_id=$1 and version=1", [item]))).rows[0];
      await expireQuote(item);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "confirm", { response_hours: 4 });
      const v = (await as("postgres", (q) => q("select version, price_1::text, valid_until > now() + interval '14 days' as renovada from public.item_quotes where item_id=$1 order by version", [item]))).rows;
      expect(v.map((x) => x.version)).toEqual([1, 2]);
      expect(v[1].price_1).toBe(before.price_1);
      expect(v[1].renovada).toBe(true);
      const c = (await as("postgres", (q) => q("select version, costo::text, factors_snapshot from public.item_costs where item_id=$1 order by version", [item]))).rows;
      expect(c[1].costo).toBe(c[0].costo);
      expect(c[1].factors_snapshot).toEqual(c[0].factors_snapshot);
      // v1 conserva su vigencia original (ya vencida): nunca se edita.
      const v1 = (await as("postgres", (q) => q("select valid_until < now() as vencida from public.item_quotes where item_id=$1 and version=1", [item]))).rows[0];
      expect(v1.vencida).toBe(true);
      expect((await itemRow(item)).estado).toBe("cotizada");
      const req = (await as("postgres", (q) => q("select resolution, resolved_version, response_business_hours::float h from public.item_update_requests where item_id=$1", [item]))).rows[0];
      expect(req).toEqual({ resolution: "sin_cambios", resolved_version: 2, h: 4 });
    });

    it("confirmar sin cambios sigue funcionando aunque los factores hayan cambiado", async () => {
      const { item } = await newQuotedItem(w, "Producto factores viejos", "300");
      await expireQuote(item);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      const old = await currentFactors();
      await rpc(w.buyer1, "insert into public.pricing_config (p5, created_by) values (1.20, $1)", [w.ids.b1]);
      await respond(w.buyer1, item, "confirm", {});
      const c = (await as("postgres", (q) => q("select version, (factors_snapshot->>'p5')::numeric as p5 from public.item_costs where item_id=$1 order by version", [item]))).rows;
      expect(Number(c[1].p5)).toBeCloseTo(old.p5, 4);
      // restaurar los factores para el resto de las pruebas
      await rpc(w.buyer1, "insert into public.pricing_config (no_shipping_markup, p1, p2, p3, p4, p5, created_by) values ($1,$2,$3,$4,$5,$6,$7)",
        [old.no_shipping_markup, old.p1, old.p2, old.p3, old.p4, old.p5, w.ids.b1]);
    });

    it("actualizar costo recalcula los 5 precios con los factores vigentes y crea v3", async () => {
      const { item } = await newQuotedItem(w, "Producto actualizar", "100");
      for (const n of [2, 3]) {
        await expireQuote(item, n - 1);
        await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
        if (n === 2) await respond(w.buyer1, item, "confirm", {});
        else await respond(w.buyer1, item, "update_cost", quotePayload("200", "20", await currentFactors(), { entrega: undefined, moneda: undefined }));
      }
      const q = (await as("postgres", (qq) => qq("select version, price_5::text, entrega_dias, moneda from public.item_quotes where item_id=$1 order by version", [item]))).rows;
      expect(q.map((x) => x.version)).toEqual([1, 2, 3]);
      expect(q[2].price_5).toBe("257.40"); // (200 + 20) * 1.17
      expect(q[2].entrega_dias).toBe(5); // heredado de la version anterior
      expect(q[1].price_5).toBe(q[0].price_5);
      const c = (await as("postgres", (qq) => qq("select version, base::text from public.item_costs where item_id=$1 order by version", [item]))).rows;
      expect(c[2].base).toBe("220.00000000");
    });

    it("update_cost y confirm exigen una solicitud abierta; el vendedor no puede responder", async () => {
      const { item } = await newQuotedItem(w, "Producto sin solicitud");
      expect(await failure(respond(w.buyer1, item, "confirm", {}))).toMatch(/no tiene una actualizacion solicitada/);
      expect(await failure(respond(w.seller1, item, "confirm", {}))).toMatch(/No autorizado/);
    });

    it("las versiones nunca se editan ni se borran (ni por el administrador)", async () => {
      const { item } = await newQuotedItem(w, "Producto bloqueo");
      for (const actor of [w.buyer1, "postgres" as const]) {
        for (const sql of ["update public.item_quotes set price_1=1", "delete from public.item_quotes", "update public.item_costs set costo=1", "delete from public.item_costs"]) {
          expect(await failure(rpc(actor, sql))).toMatch(/inmutable|permission denied/);
        }
      }
      expect(item).toBeTruthy();
    });

    it("PRIVACIDAD: el vendedor ve precios de cada version pero nunca costos, proveedores ni historial", async () => {
      const { item } = await newQuotedItem(w, "Producto privacidad", "400");
      await expireQuote(item);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "confirm", {});
      expect((await rpc(w.seller1, "select * from public.item_quotes where item_id=$1", [item])).rowCount).toBe(2);
      expect((await rpc(w.seller1, "select * from public.item_costs")).rowCount).toBe(0);
      expect((await rpc(w.seller1, "select * from public.suppliers")).rowCount).toBe(0);
      expect(await failure(rpc(w.seller1, "select * from public.similar_quotes('Producto')"))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.seller1, "select * from public.product_cost_history('Producto')"))).toMatch(/No autorizado/);
      expect((await rpc(w.seller1, "select * from public.item_sourcing")).rowCount).toBe(0);
    });

    it("cada version tiene su propio registro de envio; el precio queda fijo por version", async () => {
      const { item } = await newQuotedItem(w, "Producto envios", "100");
      await rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]);
      await rpc(w.seller1, "select public.set_item_price_choice($1,4)", [item]); // se puede cambiar antes de enviar
      await rpc(w.seller1, "select public.mark_item_dispatched($1,null)", [item]);
      const d1 = (await as("postgres", (q) => q("select precio_elegido from public.item_dispatch where item_id=$1", [item]))).rows;
      expect(d1).toEqual([{ precio_elegido: 4 }]);
      expect(await failure(as("postgres", (q) => q("update public.item_price_choice set precio=1 where item_id=$1", [item])))).toMatch(/quedo fijo/);
      await expireQuote(item);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "confirm", {});
      expect((await itemRow(item)).estado).toBe("cotizada"); // debe volver a elegir y enviar
      await rpc(w.seller1, "select public.mark_item_dispatched($1,3)", [item]);
      const d2 = (await as("postgres", (q) => q("select quote_version, precio_elegido from public.item_dispatch where item_id=$1 order by 1", [item]))).rows;
      expect(d2).toEqual([{ quote_version: 1, precio_elegido: 4 }, { quote_version: 2, precio_elegido: 3 }]);
      const log = (await as("postgres", (q) => q("select count(*)::int n from public.audit_log where entity='item_price_choice' and entity_id=$1", [item]))).rows[0];
      expect(log.n).toBeGreaterThanOrEqual(3);
    });
  });

  describe("resultado ganada o perdida", () => {
    async function dispatched(name: string) {
      const x = await newQuotedItem(w, name);
      await rpc(w.seller1, "select public.mark_item_dispatched($1,2)", [x.item]);
      return x;
    }

    it("cada envio nace sin_respuesta", async () => {
      const { item } = await dispatched("Resultado inicial");
      const r = await rpc(w.seller1, "select resultado from public.item_outcomes where item_id=$1", [item]);
      expect(r.rows).toEqual([{ resultado: "sin_respuesta" }]);
    });

    it("perdida exige motivo; 'otro' exige texto; ganada acepta cantidad final", async () => {
      const { item } = await dispatched("Resultado reglas");
      expect(await failure(rpc(w.seller1, "select public.set_item_outcome($1,'perdida')", [item]))).toMatch(/motivo es obligatorio/);
      expect(await failure(rpc(w.seller1, "select public.set_item_outcome($1,'perdida','otro')", [item]))).toMatch(/Describe el motivo/);
      await rpc(w.seller1, "select public.set_item_outcome($1,'perdida','precio_alto')", [item]);
      await rpc(w.seller1, "select public.set_item_outcome($1,'ganada',null,null,3)", [item]);
      const r = (await rpc(w.seller1, "select resultado, motivo, cantidad_final::float c from public.item_outcomes where item_id=$1", [item])).rows[0];
      expect(r).toEqual({ resultado: "ganada", motivo: null, c: 3 });
      // cada correccion queda en la bitacora con valor anterior y nuevo
      const log = (await as("postgres", (q) => q("select old_value, new_value from public.audit_log where entity='item_outcomes' and entity_id=$1 and action='update' order by id", [item]))).rows;
      expect(log.length).toBe(2);
      expect(log[1].old_value.resultado).toBe("perdida");
      expect(log[1].new_value.resultado).toBe("ganada");
    });

    it("solo el vendedor dueno puede marcarlo; el comprador no", async () => {
      const { item } = await dispatched("Resultado permisos");
      expect(await failure(rpc(w.seller2, "select public.set_item_outcome($1,'ganada')", [item]))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.buyer1, "select public.set_item_outcome($1,'ganada')", [item]))).toMatch(/No autorizado/);
    });

    it("con resultado ganada o perdida se oculta (bloquea) 'Solicitar actualizacion'", async () => {
      const { item } = await dispatched("Resultado bloquea revision");
      await rpc(w.seller1, "select public.set_item_outcome($1,'perdida','tiempo_entrega')", [item]);
      await expireQuote(item);
      expect(await failure(rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]))).toMatch(/ya tiene resultado/);
      // volver a "sin respuesta" reabre la posibilidad
      await rpc(w.seller1, "select public.set_item_outcome($1,'sin_respuesta')", [item]);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
    });
  });

  describe("historial de precios y proveedores (solo comprador)", () => {
    it("similar_quotes encuentra cotizaciones parecidas con costo, proveedor y resultado; busca por proveedor", async () => {
      const { item } = await newQuotedItem(w, "Guante de carnaza largo", "88", { proveedor: "Proveedor Zeta" });
      await rpc(w.seller1, "select public.mark_item_dispatched($1,3)", [item]);
      await rpc(w.seller1, "select public.set_item_outcome($1,'ganada')", [item]);
      const r = await rpc(w.buyer1, "select * from public.similar_quotes('guante de carnaza')");
      const hit = r.rows.find((x) => x.item_id === item);
      expect(hit).toMatchObject({ proveedor: "Proveedor Zeta", moneda: "MXN", precio_elegido: 3, resultado: "ganada" });
      expect(Number(hit.costo)).toBe(88);
      expect(hit.similitud).toBeGreaterThan(0.3);
      const byProv = await rpc(w.buyer1, "select * from public.similar_quotes(null, 'zeta')");
      expect(byProv.rows.some((x) => x.item_id === item)).toBe(true);
      const hist = await rpc(w.buyer1, "select * from public.product_cost_history('guante de carnaza')");
      expect(hist.rows.some((x) => x.item_id === item)).toBe(true);
    });

    it("el proveedor se agrega solo al catalogo y el vendedor no lo ve", async () => {
      await newQuotedItem(w, "Cinta industrial", "10", { proveedor: "Proveedor Catalogo Uno" });
      expect((await rpc(w.buyer1, "select * from public.suppliers where nombre='Proveedor Catalogo Uno'")).rowCount).toBe(1);
      expect((await rpc(w.seller1, "select * from public.suppliers")).rowCount).toBe(0);
      expect(await failure(rpc(w.seller1, "insert into public.suppliers (nombre) values ('x')"))).toMatch(/row-level security|permission denied/);
    });
  });

  describe("aclaraciones y pausa del reloj", () => {
    it("pedir aclaracion pausa; la respuesta del vendedor reanuda y devuelve el estado previo", async () => {
      const { request, item } = await newPendingItem(w, "Producto aclaracion");
      await rpc(w.buyer1, "select public.request_clarification($1,'Que medida necesitas?')", [item]);
      expect((await itemRow(item)).estado).toBe("esperando_aclaracion");
      const p = (await rpc(w.seller1, "select clarification_requested_at, resumed_at from public.item_clarification_pauses where item_id=$1", [item])).rows[0];
      expect(p.clarification_requested_at).toBeTruthy();
      expect(p.resumed_at).toBeNull();
      // mientras espera no se puede cotizar ni cerrar la pausa a mano
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("10", null, await currentFactors())))).toMatch(/ya esta cotizada/);
      expect(await failure(as("postgres", (q) => q("update public.quote_items set estado='pendiente' where id=$1", [item])))).toMatch(/sigue pendiente/);
      expect(await failure(rpc(w.seller2, "select public.post_item_message($1,'hola')", [item]))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.seller1, "select public.post_item_message($1,'x','otra/ruta.png')", [item]))).toMatch(/Ruta de imagen invalida/);
      await rpc(w.seller1, "select public.post_item_message($1,'De 1/2 pulgada',$2)", [item, `${request}/${item}/foto.png`]);
      expect((await itemRow(item)).estado).toBe("pendiente");
      const done = (await rpc(w.buyer1, "select resumed_at is not null as cerrada from public.item_clarification_pauses where item_id=$1", [item])).rows[0];
      expect(done.cerrada).toBe(true);
      const msgs = (await rpc(w.seller1, "select kind, author_rol from public.item_messages where item_id=$1 order by created_at", [item])).rows;
      expect(msgs).toEqual([{ kind: "pedir_aclaracion", author_rol: "comprador" }, { kind: "respuesta", author_rol: "vendedor" }]);
      const n = await rpc(w.buyer1, "select count(*)::int n from public.notifications where tipo='aclaracion_respondida' and user_id=$1", [w.ids.b1]);
      expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    it("el chat libre no cambia el estado; mensajes y pausas son inmutables; el vendedor no pide aclaraciones", async () => {
      const { item } = await newPendingItem(w, "Producto chat");
      await rpc(w.seller1, "select public.post_item_message($1,'Hola')", [item]);
      await rpc(w.buyer1, "select public.post_item_message($1,'Hola, vendedor')", [item]);
      expect((await itemRow(item)).estado).toBe("pendiente");
      expect(await failure(as("postgres", (q) => q("update public.item_messages set body='x'")))).toMatch(/inmutable/);
      expect(await failure(rpc(w.seller1, "select public.request_clarification($1,'x')", [item]))).toMatch(/No autorizado/);
      await rpc(w.buyer1, "select public.request_clarification($1,'x')", [item]);
      expect(await failure(as("postgres", (q) => q("delete from public.item_clarification_pauses")))).toMatch(/inmutable/);
      const other = await rpc(w.seller2, "select * from public.item_messages where item_id=$1", [item]);
      expect(other.rowCount).toBe(0);
    });
  });

  describe("producto alternativo, nombre en el PDF y busqueda por descripcion", () => {
    const ALT = { nombre: "Guante de nylon", descripcion: "Presentacion C/12 pares", motivo: "Mismo uso, recubrimiento de nitrilo" };

    /** Partida con descripcion/uso propios (interno) para probar busquedas. */
    async function itemWithUse(producto: string, uso: string) {
      const due = new Date(Date.now() + 5 * 86400_000).toISOString();
      return as(w.seller1, async (q) => {
        const r = await q("insert into public.quote_requests (id, vendedor_id, customer_id) values (gen_random_uuid(), $1, $2) returning id", [w.ids.s1, w.customerId]);
        const i = await q("insert into public.quote_items (request_id, producto, descripcion, cantidad, unidad) values ($1,$2,$3,4,'pieza') returning id", [r.rows[0].id, producto, uso]);
        await q("insert into public.item_references (item_id,tipo,url) values ($1,'link','https://a.com')", [i.rows[0].id]);
        await q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [r.rows[0].id, due]);
        return { request: r.rows[0].id as string, item: i.rows[0].id as string };
      });
    }

    it("el alternativo se guarda en la version cotizada; nombre y motivo son obligatorios; el vendedor lo ve", async () => {
      const { item } = await newPendingItem(w, "Guante solicitado");
      const f = await currentFactors();
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("100", null, f, { alternativo: { ...ALT, nombre: "  " } })))).toMatch(/nombre del producto alternativo es obligatorio/);
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("100", null, f, { alternativo: { ...ALT, motivo: "" } })))).toMatch(/sirve para lo mismo/);
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("100", null, f, { alternativo: { ...ALT, nombre: "x".repeat(201) } })))).toMatch(/200 caracteres/);
      await respond(w.buyer1, item, "quote", quotePayload("100", null, f, { alternativo: ALT }));
      const seen = (await rpc(w.seller1, "select alt_nombre, alt_descripcion, alt_motivo from public.item_quotes where item_id=$1", [item])).rows;
      expect(seen).toEqual([{ alt_nombre: ALT.nombre, alt_descripcion: ALT.descripcion, alt_motivo: ALT.motivo }]);
      // El vendedor ve el alternativo pero NO el abastecimiento ni los costos.
      expect((await rpc(w.seller1, "select * from public.item_sourcing")).rowCount).toBe(0);
      expect((await rpc(w.seller1, "select * from public.item_costs where item_id=$1", [item])).rowCount).toBe(0);
    });

    it("sin alternativo, el precio es del producto solicitado (columnas nulas)", async () => {
      const { item } = await newQuotedItem(w, "Producto normal");
      const q = (await as("postgres", (qq) => qq("select alt_nombre, alt_motivo from public.item_quotes where item_id=$1", [item]))).rows;
      expect(q).toEqual([{ alt_nombre: null, alt_motivo: null }]);
    });

    it("el alternativo queda BLOQUEADO tras cotizar (nadie lo edita ni lo borra) y se conserva por version", async () => {
      const { item } = await newPendingItem(w, "Guante bloqueo alt");
      const f = await currentFactors();
      await respond(w.buyer1, item, "quote", quotePayload("100", null, f, { alternativo: ALT }));
      for (const actor of [w.buyer1, w.seller1, "postgres" as const]) {
        expect(await failure(rpc(actor, "update public.item_quotes set alt_nombre='Otro' where item_id=$1", [item]))).toMatch(/bloquea|inmutable|permission denied|no se permite|locked|modific/i);
      }
      expect((await rpc("postgres", "select alt_nombre from public.item_quotes where item_id=$1", [item])).rows[0].alt_nombre).toBe(ALT.nombre);
      // Revision: confirm hereda; update_cost sin clave hereda; con alternativo null lo quita. Las versiones anteriores no cambian.
      await expireQuote(item, 1);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "confirm", {});
      await expireQuote(item, 2);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "update_cost", quotePayload("120", null, await currentFactors(), { entrega: undefined, moneda: undefined, alternativo: null }));
      const v = (await as("postgres", (qq) => qq("select version, alt_nombre from public.item_quotes where item_id=$1 order by version", [item]))).rows;
      expect(v).toEqual([{ version: 1, alt_nombre: ALT.nombre }, { version: 2, alt_nombre: ALT.nombre }, { version: 3, alt_nombre: null }]);
    });

    it("save_pdf_names: solo el vendedor dueno; por version; 200 caracteres; vacio vuelve al nombre por defecto; con bitacora", async () => {
      const { request, item } = await newQuotedItem(w, "Guante nombre pdf");
      const other = await newQuotedItem(w, "Otra solicitud");
      const save = (who: typeof w.seller1, names: unknown) => rpc(who, "select public.save_pdf_names($1,$2::jsonb) as n", [request, JSON.stringify(names)]);
      expect((await save(w.seller1, [{ item_id: item, nombre: "  Guante C/100 SOBRES " }])).rows[0].n).toBe(1);
      let r = (await rpc(w.seller1, "select quote_version, nombre from public.item_pdf_names where item_id=$1", [item])).rows;
      expect(r).toEqual([{ quote_version: 1, nombre: "Guante C/100 SOBRES" }]);
      expect(await failure(save(w.seller1, [{ item_id: item, nombre: "x".repeat(201) }]))).toMatch(/200 caracteres/);
      expect(await failure(save(w.seller1, [{ item_id: other.item, nombre: "ajeno" }]))).toMatch(/no pertenece/);
      expect(await failure(save(w.seller2, [{ item_id: item, nombre: "x" }]))).toMatch(/No autorizado/);
      expect(await failure(save(w.buyer1, [{ item_id: item, nombre: "x" }]))).toMatch(/No autorizado/);
      // Sin escritura directa y sin borrado.
      expect(await failure(rpc(w.seller1, "update public.item_pdf_names set nombre='x' where item_id=$1", [item]))).toMatch(/permission denied/);
      expect(await failure(rpc("postgres", "delete from public.item_pdf_names where item_id=$1", [item]))).toMatch(/inmutable|no se permite|DELETE/i);
      // Vacio = usar el nombre por defecto (no borra la fila).
      await save(w.seller1, [{ item_id: item, nombre: "" }]);
      r = (await rpc(w.seller1, "select nombre from public.item_pdf_names where item_id=$1", [item])).rows;
      expect(r).toEqual([{ nombre: null }]);
      // El comprador puede leer; la bitacora registra los cambios.
      expect((await rpc(w.buyer1, "select 1 from public.item_pdf_names where item_id=$1", [item])).rowCount).toBe(1);
      const log = (await as("postgres", (qq) => qq("select count(*)::int n from public.audit_log where entity='item_pdf_names'"))).rows[0];
      expect(log.n).toBeGreaterThanOrEqual(2);
    });

    it("similar_quotes y product_cost_history tambien buscan en la descripcion/uso y en el alternativo, y devuelven el alternativo", async () => {
      const a = await itemWithUse("Guante de punto largo", "Para hacer tamales en cocina industrial");
      await respond(w.buyer1, a.item, "quote", quotePayload("50", null, await currentFactors(), { alternativo: { nombre: "Manopla termica", motivo: "Sirve igual" } }));
      const byUse = (await rpc(w.buyer1, "select * from public.similar_quotes('tamales')")).rows.find((x) => x.item_id === a.item);
      expect(byUse).toMatchObject({ producto: "Guante de punto largo", alt_nombre: "Manopla termica", descripcion: "Para hacer tamales en cocina industrial" });
      const byAlt = (await rpc(w.buyer1, "select * from public.similar_quotes('manopla')")).rows.find((x) => x.item_id === a.item);
      expect(byAlt).toBeTruthy();
      expect((await rpc(w.buyer1, "select * from public.product_cost_history('tamales')")).rows.some((x) => x.item_id === a.item)).toBe(true);
      // Solo el comprador usa la busqueda.
      expect(await failure(rpc(w.seller1, "select * from public.similar_quotes('tamales')"))).toMatch(/No autorizado/);
    });
  });

  describe("compra minima obligatoria y decision del vendedor", () => {
    it("quote y update_cost exigen compra minima (cantidad >= 1 y unidad); confirm la hereda", async () => {
      const { item } = await newPendingItem(w, "Producto minimo");
      const f = await currentFactors();
      const sin = quotePayload("100", null, f);
      delete (sin as Record<string, unknown>).compra_min;
      expect(await failure(respond(w.buyer1, item, "quote", sin))).toMatch(/compra minima es obligatoria/);
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("100", null, f, { compra_min: { cantidad: 0.5, unidad: "pieza" } })))).toMatch(/compra minima es obligatoria/);
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("100", null, f, { compra_min: { cantidad: 5, unidad: " " } })))).toMatch(/compra minima es obligatoria/);
      expect(await failure(respond(w.buyer1, item, "quote", quotePayload("100", null, f, { compra_min: null })))).toMatch(/compra minima es obligatoria/);
      await respond(w.buyer1, item, "quote", quotePayload("100", null, f, { compra_min: { cantidad: 10, unidad: "caja", monto: 1500 } }));
      const v1 = (await rpc(w.seller1, "select compra_min_cantidad::float c, compra_min_unidad u, compra_min_monto::float m from public.item_quotes where item_id=$1", [item])).rows[0];
      expect(v1).toEqual({ c: 10, u: "caja", m: 1500 });

      // Revisiones: confirm hereda; update_cost exige el minimo valido y se conserva por version.
      await expireQuote(item, 1);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "confirm", {});
      await expireQuote(item, 2);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      expect(await failure(respond(w.buyer1, item, "update_cost", quotePayload("120", null, await currentFactors(), { entrega: undefined, moneda: undefined, compra_min: { cantidad: 0, unidad: "caja" } })))).toMatch(/compra minima es obligatoria/);
      await respond(w.buyer1, item, "update_cost", quotePayload("120", null, await currentFactors(), { entrega: undefined, moneda: undefined, compra_min: { cantidad: 1, unidad: "caja" } }));
      const v = (await as("postgres", (qq) => qq("select version, compra_min_cantidad::float c from public.item_quotes where item_id=$1 order by version", [item]))).rows;
      expect(v).toEqual([{ version: 1, c: 10 }, { version: 2, c: 10 }, { version: 3, c: 1 }]);
    });

    it("el minimo queda BLOQUEADO tras cotizar (nadie lo edita) y el vendedor no lee costos", async () => {
      const { item } = await newQuotedItem(w, "Producto minimo bloqueado", "100", { compra_min: { cantidad: 6, unidad: "pieza" } });
      for (const actor of [w.buyer1, w.seller1, "postgres" as const]) {
        expect(await failure(rpc(actor, "update public.item_quotes set compra_min_cantidad=1 where item_id=$1", [item]))).toMatch(/bloquea|inmutable|permission denied|no se permite|locked|modific/i);
      }
      expect((await rpc(w.seller1, "select compra_min_cantidad::float c from public.item_quotes where item_id=$1", [item])).rows[0].c).toBe(6);
      expect((await rpc(w.seller1, "select * from public.item_costs where item_id=$1", [item])).rowCount).toBe(0);
    });

    it("las cotizaciones anteriores sin cantidad siguen siendo validas (la regla solo aplica a filas nuevas)", async () => {
      const r = await as("postgres", (qq) => qq("select convalidated from pg_constraint where conname='item_quotes_compra_min_cantidad_ge1_check'"));
      expect(r.rows[0].convalidated).toBe(false);
    });

    it("save_pdf_minimos: solo el vendedor dueno; decisiones validas; por revision y con bitacora", async () => {
      const { request, item } = await newQuotedItem(w, "Producto decision");
      const other = await newQuotedItem(w, "Otra solicitud min");
      const save = (who: typeof w.seller1, items: unknown) => rpc(who, "select public.save_pdf_minimos($1,$2::jsonb) as n", [request, JSON.stringify(items)]);
      expect((await save(w.seller1, [{ item_id: item, decision: "cotizar_minimo" }])).rows[0].n).toBe(1);
      expect(await failure(save(w.seller1, [{ item_id: item, decision: "otra" }]))).toMatch(/Elige cotizar/);
      expect(await failure(save(w.seller1, [{ item_id: item }]))).toMatch(/Elige cotizar/);
      expect(await failure(save(w.seller1, [{ item_id: other.item, decision: "mantener_pedida" }]))).toMatch(/no pertenece/);
      expect(await failure(save(w.seller2, [{ item_id: item, decision: "mantener_pedida" }]))).toMatch(/No autorizado/);
      expect(await failure(save(w.buyer1, [{ item_id: item, decision: "mantener_pedida" }]))).toMatch(/No autorizado/);
      await save(w.seller1, [{ item_id: item, decision: "mantener_pedida" }]);
      const rows = (await rpc(w.seller1, "select revision, decision from public.quote_pdf_min_choices where request_id=$1", [request])).rows;
      expect(rows).toEqual([{ revision: 1, decision: "mantener_pedida" }]);
      expect(await failure(rpc(w.seller1, "insert into public.quote_pdf_min_choices (request_id, revision, item_id, decision, updated_by) values ($1,1,$2,'cotizar_minimo',$3)", [request, item, w.ids.s1]))).toMatch(/permission denied|row-level security/);
      expect((await rpc(w.buyer1, "select 1 from public.quote_pdf_min_choices where request_id=$1", [request])).rowCount).toBe(1);
      const log = (await as("postgres", (qq) => qq("select count(*)::int n from public.audit_log where entity='quote_pdf_min_choices'"))).rows[0];
      expect(log.n).toBeGreaterThanOrEqual(2);
    });
  });

  describe("PDF y datos del cliente", () => {
    it("save_draft guarda atencion y destino_entrega", async () => {
      const rid = randomUUID(); const iid = randomUUID();
      await rpc(w.seller1, "select public.save_draft($1::jsonb)", [JSON.stringify({
        request_id: rid, customer_id: w.customerId, atencion: "Ing. Perez", destino_entrega: "Cd. Juarez, planta Pegatron",
        items: [{ id: iid, producto: "X", descripcion: "Descripcion larga", cantidad: 1, unidad: "pieza", refs: [] }],
      })]);
      const r = (await rpc(w.seller1, "select atencion, destino_entrega from public.quote_requests where id=$1", [rid])).rows[0];
      expect(r).toEqual({ atencion: "Ing. Perez", destino_entrega: "Cd. Juarez, planta Pegatron" });
    });

    it("save_pdf_data (funcion anterior): aparte equivale a por_pedido, revision = version mas alta, solo el vendedor dueno", async () => {
      const { request } = await newQuotedItem(w, "Producto PDF");
      expect(await failure(rpc(w.seller1, "select public.save_pdf_data($1,'Destino','Parcel','Credito','Ing',$2,null,null)", [request, "aparte"]))).toMatch(/monto y la moneda/);
      const rev = await rpc(w.seller1, "select public.save_pdf_data($1,'Cd. Juarez','Flete','Contado','Ing. Perez','aparte',350,'MXN') as rev", [request]);
      expect(rev.rows[0].rev).toBe(1);
      await rpc(w.seller1, "select public.save_pdf_data($1,'Cd. Juarez','Flete','Contado','Ing. Perez','incluido',null,null)", [request]);
      const d = (await rpc(w.seller1, "select envio_modo, envio_monto, condiciones from public.quote_pdf_data where request_id=$1", [request])).rows;
      expect(d).toEqual([{ envio_modo: "incluido", envio_monto: null, condiciones: "Contado" }]);
      await rpc(w.seller1, "select public.save_pdf_data($1,'Cd. Juarez','Flete','Contado','Ing. Perez','aparte',350,'MXN')", [request]);
      const conv = (await rpc(w.seller1, "select envio_modo, envio_monto::float m, envio_moneda from public.quote_pdf_data where request_id=$1", [request])).rows;
      expect(conv).toEqual([{ envio_modo: "por_pedido", m: 350, envio_moneda: "MXN" }]);
      await rpc(w.seller1, "select public.save_pdf_data($1,'Cd. Juarez','Flete','Contado','Ing. Perez','incluido',null,null)", [request]);
      expect(await failure(rpc(w.seller2, "select public.save_pdf_data($1,'x','x','x','x','incluido',null,null)", [request]))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.buyer1, "select public.save_pdf_data($1,'x','x','x','x','incluido',null,null)", [request]))).toMatch(/No autorizado/);
      const log = (await as("postgres", (q) => q("select count(*)::int n from public.audit_log where entity='quote_pdf_data'"))).rows[0];
      expect(log.n).toBeGreaterThanOrEqual(2);
    });

    it("save_pdf_envio: modos por unidad, por pedido y por partida; revision y permisos", async () => {
      const { request, item } = await newQuotedItem(w, "Producto envio");
      const call = (who: typeof w.seller1, args: unknown[]) =>
        rpc(who, "select public.save_pdf_envio($1,'Cd. Juarez','Flete','Credito','Ing',$2,$3,$4,$5::jsonb) as rev", [request, ...args]);
      expect(await failure(call(w.seller1, ["por_pedido", null, null, null]))).toMatch(/monto y la moneda/);
      expect(await failure(call(w.seller1, ["raro", 1, "MXN", null]))).toMatch(/Modo de envio invalido/);
      expect(await failure(call(w.seller1, ["por_partida", null, "MXN", "[]"]))).toMatch(/al menos una partida/);
      expect(await failure(call(w.seller1, ["por_partida", null, "MXN", JSON.stringify([{ item_id: randomUUID(), monto: 5, tipo: "total" }])]))).toMatch(/no pertenece/);
      expect(await failure(call(w.seller1, ["por_partida", null, "MXN", JSON.stringify([{ item_id: item, monto: 5, tipo: "otro" }])]))).toMatch(/por unidad o total/);

      expect((await call(w.seller1, ["por_unidad", 50, "MXN", null])).rows[0].rev).toBe(1);
      let d = (await rpc(w.seller1, "select envio_modo, envio_monto::float m, envio_moneda from public.quote_pdf_data where request_id=$1", [request])).rows;
      expect(d).toEqual([{ envio_modo: "por_unidad", m: 50, envio_moneda: "MXN" }]);

      await call(w.seller1, ["por_pedido", 100, "USD", null]);
      await call(w.seller1, ["por_partida", null, "MXN", JSON.stringify([{ item_id: item, monto: 120, tipo: "total" }])]);
      d = (await rpc(w.seller1, "select envio_modo, envio_monto, envio_moneda from public.quote_pdf_data where request_id=$1", [request])).rows;
      expect(d).toEqual([{ envio_modo: "por_partida", envio_monto: null, envio_moneda: "MXN" }]);
      const si = (await rpc(w.seller1, "select item_id, monto::float m, tipo from public.quote_pdf_shipping_items where request_id=$1", [request])).rows;
      expect(si).toEqual([{ item_id: item, m: 120, tipo: "total" }]);

      // Volver a otro modo limpia los montos por partida; sin envio no guarda moneda ni monto.
      await call(w.seller1, ["incluido", null, null, null]);
      expect((await rpc(w.seller1, "select 1 from public.quote_pdf_shipping_items where request_id=$1", [request])).rowCount).toBe(0);
      d = (await rpc(w.seller1, "select envio_modo, envio_monto, envio_moneda from public.quote_pdf_data where request_id=$1", [request])).rows;
      expect(d).toEqual([{ envio_modo: "incluido", envio_monto: null, envio_moneda: null }]);

      // Otro vendedor o el comprador no pueden guardar; el comprador si puede leer.
      expect(await failure(call(w.seller2, ["incluido", null, null, null]))).toMatch(/No autorizado/);
      expect(await failure(call(w.buyer1, ["incluido", null, null, null]))).toMatch(/No autorizado/);
      expect((await rpc(w.buyer1, "select 1 from public.quote_pdf_data where request_id=$1", [request])).rowCount).toBe(1);
      // Sin escritura directa a la tabla de montos por partida.
      expect(await failure(rpc(w.seller1, "insert into public.quote_pdf_shipping_items (request_id, revision, item_id, monto, tipo, updated_by) values ($1,1,$2,1,'total',$3)", [request, item, w.ids.s1]))).toMatch(/permission denied/);
      // Bitacora de los montos por partida.
      const log = (await as("postgres", (q) => q("select count(*)::int n from public.audit_log where entity='quote_pdf_shipping_items'"))).rows[0];
      expect(log.n).toBeGreaterThanOrEqual(2);
    });

    it("leyenda_envio: valor por defecto y edicion solo del comprador", async () => {
      const l = (await rpc(w.seller1, "select leyenda_envio from public.company_profile")).rows[0].leyenda_envio;
      expect(l).toContain("{destino}");
      expect((await rpc(w.seller1, "update public.company_profile set leyenda_envio='x'")).rowCount).toBe(0);
      expect((await rpc(w.buyer1, "update public.company_profile set leyenda_envio=$1, updated_by=$2", [l, w.ids.b1])).rowCount).toBe(1);
    });

    it("company_profile: lectura para todos, edicion solo del comprador; download_pdf se registra", async () => {
      expect((await rpc(w.seller1, "select * from public.company_profile")).rowCount).toBe(1);
      expect((await rpc(w.seller1, "update public.company_profile set rfc='X'")).rowCount).toBe(0);
      expect((await rpc(w.buyer1, "update public.company_profile set condiciones_default='Credito', updated_by=$1", [w.ids.b1])).rowCount).toBe(1);
      const { request } = await newPendingItem(w, "Producto log pdf");
      await rpc(w.seller1, "select public.log_event('download_pdf','quote_requests',$1,'{\"revision\":1}')", [request]);
      expect(await failure(rpc(w.seller1, "select public.log_event('otra_cosa','x','1')"))).toMatch(/no permitida/);
    });
  });

  describe("abastecimiento (solo comprador)", () => {
    it("el comprador captura y edita aunque la partida ya este cotizada, sin debilitar el bloqueo de costos; cada cambio queda en bitacora", async () => {
      const { item } = await newQuotedItem(w, "Producto abastecimiento");
      await rpc(w.buyer1, "select public.save_item_sourcing($1,'Ferreteria Norte','https://tienda.example/p/1','Luis 614 555 0000','PN-123','Pedir con 3 dias')", [item]);
      await rpc(w.buyer1, "select public.save_item_sourcing($1,'Ferreteria Norte','https://tienda.example/p/2','Luis','PN-123','Pedir con 5 dias')", [item]);
      const s = (await rpc(w.buyer1, "select link_producto, notas_compra from public.item_sourcing where item_id=$1", [item])).rows[0];
      expect(s).toEqual({ link_producto: "https://tienda.example/p/2", notas_compra: "Pedir con 5 dias" });
      const log = (await as("postgres", (q) => q("select action, old_value, new_value from public.audit_log where entity='item_sourcing' and entity_id=$1 order by id", [item]))).rows;
      expect(log.map((x) => x.action)).toEqual(["insert", "update"]);
      expect(log[1].old_value.link_producto).toBe("https://tienda.example/p/1");
      expect(log[1].new_value.link_producto).toBe("https://tienda.example/p/2");
      expect(await failure(rpc(w.buyer1, "update public.item_costs set costo=1"))).toMatch(/inmutable|permission denied/);
      expect(await failure(rpc(w.buyer1, "select public.save_item_sourcing($1,null,'javascript:alert(1)',null,null,null)", [item]))).toMatch(/http/);
      expect((await rpc(w.buyer1, "select * from public.suppliers where nombre='Ferreteria Norte'")).rowCount).toBe(1);
    });

    it("PRIVACIDAD: el vendedor no puede leer ni usar item_sourcing, item_purchases ni las funciones", async () => {
      const { item } = await newQuotedItem(w, "Producto abastecimiento privado");
      await rpc(w.buyer1, "select public.save_item_sourcing($1,'Secreto SA','https://secreto.example','Contacto','P1','nota')", [item]);
      expect((await rpc(w.seller1, "select * from public.item_sourcing")).rowCount).toBe(0);
      expect((await rpc(w.seller1, "select * from public.item_purchases")).rowCount).toBe(0);
      for (const sql of [
        "select * from public.get_item_sourcing($1)",
        "select public.save_item_sourcing($1,'x',null,null,null,null)",
        "select public.mark_item_purchased($1,true)",
      ]) expect(await failure(rpc(w.seller1, sql, [item]))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.seller1, "select * from public.por_comprar()"))).toMatch(/No autorizado/);
      expect(await failure(rpc(w.seller1, "insert into public.item_sourcing (item_id, proveedor) values ($1,'x')", [item]))).toMatch(/permission denied|row-level security/);
      // tampoco aparece en lo que el vendedor consulta de la partida
      const visible = JSON.stringify((await rpc(w.seller1, "select to_jsonb(i) as i, (select jsonb_agg(to_jsonb(q)) from public.item_quotes q where q.item_id=i.id) as q from public.quote_items i where i.id=$1", [item])).rows);
      expect(visible).not.toMatch(/Secreto|secreto\.example/);
    });

    it("Por comprar: solo ganadas, con alerta si falta proveedor, filtro y marca Comprada con fecha y usuario", async () => {
      const a = await newQuotedItem(w, "Ganada con datos", "50");
      const b = await newQuotedItem(w, "Ganada sin datos", "60");
      const c = await newQuotedItem(w, "Perdida", "70");
      for (const x of [a, b, c]) await rpc(w.seller1, "select public.mark_item_dispatched($1,1)", [x.item]);
      await rpc(w.seller1, "select public.set_item_outcome($1,'ganada',null,null,7)", [a.item]);
      await rpc(w.seller1, "select public.set_item_outcome($1,'ganada')", [b.item]);
      await rpc(w.seller1, "select public.set_item_outcome($1,'perdida','precio_alto')", [c.item]);
      await rpc(w.buyer1, "select public.save_item_sourcing($1,'Proveedor Compra','https://compra.example/x','Ana','PN-9','Urgente')", [a.item]);

      const all = (await rpc(w.buyer1, "select * from public.por_comprar()")).rows;
      const ids = all.map((r) => r.item_id);
      expect(ids).toContain(a.item);
      expect(ids).toContain(b.item);
      expect(ids).not.toContain(c.item);
      const ra = all.find((r) => r.item_id === a.item);
      const rb = all.find((r) => r.item_id === b.item);
      expect(ra).toMatchObject({ proveedor: "Proveedor Compra", falta_proveedor: false, link_producto: "https://compra.example/x" });
      expect(Number(ra.cantidad)).toBe(7); // cantidad final
      expect(Number(ra.costo)).toBe(50);
      expect(rb.falta_proveedor).toBe(true);
      expect(Number(rb.cantidad)).toBe(4); // la solicitada

      const filtered = (await rpc(w.buyer1, "select item_id from public.por_comprar('Proveedor Compra')")).rows;
      expect(filtered).toEqual([{ item_id: a.item }]);

      await rpc(w.buyer1, "select public.mark_item_purchased($1,true)", [a.item]);
      const done = (await rpc(w.buyer1, "select comprada_at, comprada_por from public.por_comprar(null,null,null,'compradas') where item_id=$1", [a.item])).rows[0];
      expect(done.comprada_at).toBeTruthy();
      expect(done.comprada_por).toContain("Comp A");
      expect((await rpc(w.buyer1, "select item_id from public.por_comprar(null,null,null,'pendientes') where item_id=$1", [a.item])).rowCount).toBe(0);
      const log = (await as("postgres", (q) => q("select count(*)::int n from public.audit_log where entity='item_purchases' and entity_id=$1", [a.item]))).rows[0];
      expect(log.n).toBe(1);
    });

    it("el abastecimiento se comparte entre versiones (una fila por partida)", async () => {
      const { item } = await newQuotedItem(w, "Producto versiones abastecimiento");
      await rpc(w.buyer1, "select public.save_item_sourcing($1,'Prov V','https://v.example',null,null,null)", [item]);
      await expireQuote(item);
      await rpc(w.seller1, "select public.request_item_update($1,null,$2)", [item, dueIn48()]);
      await respond(w.buyer1, item, "confirm", {});
      expect((await rpc(w.buyer1, "select * from public.item_sourcing where item_id=$1", [item])).rowCount).toBe(1);
      const g = (await rpc(w.buyer1, "select * from public.get_item_sourcing($1)", [item])).rows[0];
      expect(g.proveedor).toBe("Prov V");
    });
  });
  });
}

void FACTORS;
