import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure } from "./helpers";
import { createWorld, newQuotedItem, type World } from "./fixtures";

let w: World;
const SNAP = JSON.stringify({ folio: "x", rows: [], totals: [] });
const rpc = (actor: Parameters<typeof as>[0], sql: string, params: unknown[] = []) => as(actor, (q) => q(sql, params));
const issue = (actor: Parameters<typeof as>[0], request: string, medio = "correo") =>
  rpc(actor, "select * from public.issue_quote($1,$2,'compras@cliente.example',null,$3::jsonb)", [request, medio, SNAP]).then((r) => r.rows[0] as { issue_id: string; numero: string });
const folioOf = async (request: string) => (await rpc("postgres", "select folio from public.quote_requests where id=$1", [request])).rows[0].folio as string;

export function emisionesSuite() {
  describe.skipIf(!DATABASE_URL)("Envio al cliente, emisiones y recotizacion", () => {
    beforeAll(async () => {
      w = await createWorld();
    });

    it("registrar el envio crea el numero, las lineas, el envio y marca las partidas como enviadas", async () => {
      const { request, item } = await newQuotedItem(w);
      expect(await failure(issue(w.seller1, request))).toMatch(/Elige el precio/);
      await rpc(w.seller1, "select public.set_item_price_choice($1,3)", [item]);
      expect(await failure(issue(w.seller1, request, "fax"))).toMatch(/medio/);
      expect(await failure(issue(w.seller2, request))).toMatch(/No autorizado/);
      const r = await issue(w.seller1, request, "whatsapp");
      expect(r.numero).toBe(await folioOf(request));
      const st = await rpc("postgres", "select estado from public.quote_items where id=$1", [item]);
      expect(st.rows[0].estado).toBe("enviada_cliente");
      const line = await rpc(w.seller1, "select precio_elegido from public.quote_issue_lines where issue_id=$1", [r.issue_id]);
      expect(line.rows[0].precio_elegido).toBe(3);
      const snap = await rpc(w.seller1, "select snapshot->>'folio' as f from public.quote_issues where id=$1", [r.issue_id]);
      expect(snap.rows[0].f).toBe(r.numero);
      const sends = await rpc(w.seller1, "select medio, destinatario from public.quote_issue_sends where issue_id=$1", [r.issue_id]);
      expect(sends.rows).toEqual([{ medio: "whatsapp", destinatario: "compras@cliente.example" }]);
      // El comprador ve la emision; otro vendedor no.
      expect((await rpc(w.buyer1, "select id from public.quote_issues where id=$1", [r.issue_id])).rowCount).toBe(1);
      expect((await rpc(w.seller2, "select id from public.quote_issues where id=$1", [r.issue_id])).rowCount).toBe(0);
    });

    it("no se duplica el numero: sin cambios pide registrar otro envio o recotizar", async () => {
      const { request, item } = await newQuotedItem(w);
      await rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]);
      const r = await issue(w.seller1, request);
      expect(await failure(issue(w.seller1, request))).toMatch(/Registrar otro envio/);
      await rpc(w.seller1, "select public.register_issue_send($1,'whatsapp','656 000 0000',null)", [r.issue_id]);
      const n = await rpc(w.seller1, "select count(*)::int as n from public.quote_issue_sends where issue_id=$1", [r.issue_id]);
      expect(n.rows[0].n).toBe(2);
      expect(await failure(rpc(w.seller2, "select public.register_issue_send($1,'correo',null,null)", [r.issue_id]))).toMatch(/No autorizado/);
    });

    it("el precio enviado queda fijo hasta recotizar; recotizar da numero -V2 y conserva la emision anterior", async () => {
      const { request, item } = await newQuotedItem(w);
      await rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]);
      const first = await issue(w.seller1, request);
      expect(await failure(rpc(w.seller1, "select public.set_item_price_choice($1,4)", [item]))).toMatch(/no esta lista|quedo fijo/);
      expect(await failure(rpc(w.seller1, "select public.open_renegotiation($1,'')", [request]))).toMatch(/motivo/);
      await rpc(w.seller1, "select public.open_renegotiation($1,'Cliente pidio mejor precio')", [request]);
      expect(await failure(rpc(w.seller1, "select public.open_renegotiation($1,'Otra vez')", [request]))).toMatch(/Ya hay una recotizacion/);
      await rpc(w.seller1, "select public.set_item_price_choice($1,4)", [item]);
      const second = await issue(w.seller1, request, "correo");
      expect(second.numero).toBe(`${await folioOf(request)}-V2`);
      const d = await rpc("postgres", "select precio_elegido, valor::float from public.item_dispatch where item_id=$1", [item]);
      expect(d.rows[0].precio_elegido).toBe(4);
      const old = await rpc(w.seller1, "select precio_elegido from public.quote_issue_lines where issue_id=$1", [first.issue_id]);
      expect(old.rows[0].precio_elegido).toBe(2);
      const reneg = await rpc(w.seller1, "select issue_id, cerrada_at is not null as cerrada from public.quote_renegotiations where request_id=$1", [request]);
      expect(reneg.rows[0]).toEqual({ issue_id: second.issue_id, cerrada: true });
      // Cerrada la recotizacion, el precio vuelve a quedar fijo.
      expect(await failure(rpc(w.seller1, "select public.set_item_price_choice($1,5)", [item]))).toBeTruthy();
    });

    it("cancelar la recotizacion regresa el precio al ya enviado", async () => {
      const { request, item } = await newQuotedItem(w);
      await rpc(w.seller1, "select public.set_item_price_choice($1,1)", [item]);
      await issue(w.seller1, request);
      await rpc(w.seller1, "select public.open_renegotiation($1,'Ajuste de precio')", [request]);
      await rpc(w.seller1, "select public.set_item_price_choice($1,5)", [item]);
      await rpc(w.seller1, "select public.cancel_renegotiation($1)", [request]);
      const c = await rpc("postgres", "select precio from public.item_price_choice where item_id=$1", [item]);
      expect(c.rows[0].precio).toBe(1);
      const r = await rpc("postgres", "select cancelada from public.quote_renegotiations where request_id=$1", [request]);
      expect(r.rows[0].cancelada).toBe(true);
    });

    it("emisiones, lineas y envios son inmutables; el envio al cliente solo cambia por una emision", async () => {
      const { request, item } = await newQuotedItem(w);
      await rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]);
      const r = await issue(w.seller1, request);
      expect(await failure(rpc("postgres", "update public.quote_issues set numero='X' where id=$1", [r.issue_id]))).toMatch(/inmutable/);
      expect(await failure(rpc("postgres", "delete from public.quote_issue_sends where issue_id=$1", [r.issue_id]))).toMatch(/inmutable/);
      expect(await failure(rpc("postgres", "update public.item_dispatch set precio_elegido=5 where item_id=$1", [item]))).toMatch(/inmutable/);
      expect(await failure(rpc(w.seller1, "insert into public.quote_issues (request_id, revision, secuencia, numero, snapshot, emitida_por) values ($1,1,9,'Z','{}',$2)", [request, w.ids.s1]))).toMatch(/permission denied/);
    });

    it("datos del PDF: bloqueados despues de enviar, se liberan al recotizar; presentacion del envio validada", async () => {
      const { request, item } = await newQuotedItem(w);
      const save = (pres: string, modo: string, monto: number | null, aparte: number | null) =>
        rpc(w.seller1, "select public.save_pdf_envio_v2($1,'Cd. Juarez','Flete','Credito',null,$2,$3,'MXN',null,$4,$5,'MXN')", [request, modo, monto, pres, aparte]);
      expect(await failure(save("aparte", "incluido", null, null))).toMatch(/envio aparte/);
      expect(await failure(save("incluido", "incluido", null, null))).toMatch(/incluido en los precios/);
      await save("mixto", "por_pedido", 100, 50);
      const row = await rpc("postgres", "select envio_presentacion, envio_aparte_monto::float as a, envio_modo from public.quote_pdf_data where request_id=$1", [request]);
      expect(row.rows[0]).toEqual({ envio_presentacion: "mixto", a: 50, envio_modo: "por_pedido" });
      await rpc(w.seller1, "select public.set_item_price_choice($1,2)", [item]);
      await issue(w.seller1, request);
      expect(await failure(save("sin_envio", "incluido", null, null))).toMatch(/Recotizar/);
      await rpc(w.seller1, "select public.open_renegotiation($1,'Quitar envio, recoge el cliente')", [request]);
      await save("sin_envio", "incluido", null, null);
    });

    it("no se puede recotizar algo que no se ha enviado", async () => {
      const { request } = await newQuotedItem(w);
      expect(await failure(rpc(w.seller1, "select public.open_renegotiation($1,'Mejor precio')", [request]))).toMatch(/Primero registra/);
    });
  });

  describe.skipIf(!DATABASE_URL)("Base general de clientes", () => {
    beforeAll(async () => {
      if (!w) w = await createWorld();
    });

    it("el vendedor da de alta un cliente completo; RFC y correo se normalizan y validan", async () => {
      const tag = randomUUID().slice(0, 6);
      const id = (await rpc(w.seller1, "insert into public.customers (nombre, rfc, direccion, contacto_correo, created_by) values ($1,' abc-010101 ab1 ','Calle 2, Juarez','COMPRAS@Norte.MX',$2) returning id", [`Planta Norte ${tag}`, w.ids.s1])).rows[0].id;
      const c = await rpc("postgres", "select rfc, contacto_correo from public.customers where id=$1", [id]);
      expect(c.rows[0]).toEqual({ rfc: "ABC010101AB1", contacto_correo: "compras@norte.mx" });
      expect(await failure(rpc(w.seller1, "insert into public.customers (nombre, rfc, created_by) values ($2,'123',$1)", [w.ids.s1, `X ${randomUUID().slice(0, 6)}`]))).toMatch(/RFC invalido/);
      expect((await rpc("postgres", "select public.customer_is_complete($1) as ok", [id])).rows[0].ok).toBe(true);
    });

    it("todos los vendedores ven y completan clientes; solo el comprador los desactiva", async () => {
      const id = (await rpc(w.seller1, "insert into public.customers (nombre, created_by) values ($2,$1) returning id", [w.ids.s1, `Solo nombre ${randomUUID().slice(0, 6)}`])).rows[0].id;
      expect((await rpc(w.seller2, "select id from public.customers where id=$1", [id])).rowCount).toBe(1);
      await rpc(w.seller2, "update public.customers set rfc='SNS010101AB1', direccion='Av. 1, Chihuahua', contacto_telefono='6140000000' where id=$1", [id]);
      expect((await rpc("postgres", "select public.customer_is_complete($1) as ok", [id])).rows[0].ok).toBe(true);
      expect(await failure(rpc(w.seller2, "update public.customers set activo=false where id=$1", [id]))).toMatch(/Solo el comprador/);
      await rpc(w.buyer1, "update public.customers set activo=false where id=$1", [id]);
    });

    it("no se puede enviar una solicitud si el cliente no tiene RFC, direccion y contacto", async () => {
      const cust = (await rpc(w.seller1, "insert into public.customers (nombre, created_by) values ($2,$1) returning id", [w.ids.s1, `Incompleto ${randomUUID().slice(0, 6)}`])).rows[0].id;
      const req = (await rpc(w.seller1, "insert into public.quote_requests (id, vendedor_id, customer_id) values (gen_random_uuid(),$1,$2) returning id", [w.ids.s1, cust])).rows[0].id;
      await rpc(w.seller1, "insert into public.quote_items (request_id, producto, descripcion, cantidad, unidad) values ($1,'Guante','Descripcion suficiente',4,'pieza')", [req]);
      await rpc("postgres", "insert into public.item_references (item_id, tipo, url) select id, 'link', 'https://x.example' from public.quote_items where request_id=$1", [req]);
      const send = () => rpc(w.seller1, "update public.quote_requests set estado='enviada', due_at=now() + interval '2 days' where id=$1", [req]);
      expect(await failure(send())).toMatch(/Completa los datos del cliente/);
      await rpc(w.seller1, "update public.customers set rfc='INC010101AB1', direccion='Calle 9, Juarez', contacto_correo='a@b.mx' where id=$1", [cust]);
      await send();
    });
  });
}
