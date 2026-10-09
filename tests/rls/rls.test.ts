import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calcTabulador } from "@/lib/pricing/tabulador";
import { DATABASE_URL, as, failure, pool, type Actor } from "./helpers";

const seller1 = randomUUID();
const seller2 = randomUUID();
const buyer1 = randomUUID();
const buyer2 = randomUUID();
const S1: Actor = { id: seller1, role: "authenticated" };
const S2: Actor = { id: seller2, role: "authenticated" };
const B1: Actor = { id: buyer1, role: "authenticated" };
const B2: Actor = { id: buyer2, role: "authenticated" };
const ANON: Actor = { id: randomUUID(), role: "anon" };

const FACTORS = {
  no_shipping_markup: 0.04,
  p5: 1.17,
  p4: 1.26,
  p3: 1.35,
  p2: 1.43,
  p1: 1.54,
};

let customerId: string;
let requestId: string;
let itemId: string;
let item2Id: string;

function quotePayload(cost: string, shipping: string | null, factors = FACTORS, overrides: Record<string, unknown> = {}) {
  const t = calcTabulador(cost, shipping, {
    noShippingMarkup: factors.no_shipping_markup,
    p1: factors.p1,
    p2: factors.p2,
    p3: factors.p3,
    p4: factors.p4,
    p5: factors.p5,
  });
  return {
    costo: cost,
    envio: shipping,
    moneda: "MXN",
    factors,
    prices: { p1: t.p1, p2: t.p2, p3: t.p3, p4: t.p4, p5: t.p5 },
    entrega: { dias: 5, tipo: "habiles" },
    proveedor: "ACME",
    nota: "nota",
    response_hours: 2,
    ...overrides,
  };
}

const respond = (actor: Actor, item: string, action: string, payload: unknown) =>
  as(actor, (q) => q("select public.respond_item($1,$2,$3::jsonb)", [item, action, JSON.stringify(payload)]));

async function respondQuoted(actor: Actor, item: string, cost: string, shipping: string | null) {
  return respond(actor, item, "quote", quotePayload(cost, shipping));
}

describe.skipIf(!DATABASE_URL)("RLS e integridad (requiere Postgres con migraciones)", () => {
  beforeAll(async () => {
    await as("postgres", async (q) => {
      for (const [id, nombre, rol] of [
        [seller1, "Vendedor Uno", "vendedor"],
        [seller2, "Vendedor Dos", "vendedor"],
        [buyer1, "Comprador Uno", "comprador"],
        [buyer2, "Comprador Dos", "comprador"],
      ]) {
        await q("insert into auth.users (id, email) values ($1, $2)", [id, `${nombre}@esc.test`]);
        await q(
          "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)",
          [id, nombre, `${nombre.replace(" ", "")}@esc.test`, rol],
        );
      }
      const c = await q("insert into public.customers (nombre, tipo) values ('Cliente SA','cliente') returning id");
      customerId = c.rows[0].id;
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("usuarios", () => {
    it("un vendedor no puede crear usuarios", async () => {
      const msg = await failure(
        as(S1, (q) =>
          q("select public.admin_create_profile($1,'X','x@esc.test','vendedor')", [randomUUID()]),
        ),
      );
      expect(msg).toMatch(/No autorizado/);
    });

    it("un vendedor no puede desactivar, resetear ni renombrar usuarios", async () => {
      for (const sql of [
        "select public.admin_set_user_active($1, false)",
        "select public.admin_flag_password_reset($1)",
        "select public.admin_update_user($1, 'Hack')",
      ]) {
        expect(await failure(as(S1, (q) => q(sql, [seller2])))).toMatch(/No autorizado/);
      }
    });

    it("un vendedor no puede escribir en profiles directamente", async () => {
      expect(
        await failure(as(S1, (q) => q("update public.profiles set rol='comprador' where id=$1", [seller1]))),
      ).toMatch(/permission denied/);
    });

    it("el comprador crea un perfil con cambio de contrasena obligatorio", async () => {
      const id = randomUUID();
      await as("postgres", (q) => q("insert into auth.users (id,email) values ($1,'nuevo@esc.test')", [id]));
      await as(B1, (q) => q("select public.admin_create_profile($1,'Nuevo','Nuevo@esc.test','vendedor')", [id]));
      const r = await as("postgres", (q) =>
        q("select rol, must_change_password, correo from public.profiles where id=$1", [id]),
      );
      expect(r.rows[0]).toEqual({ rol: "vendedor", must_change_password: true, correo: "nuevo@esc.test" });
      // El cambio de contrasena limpia la marca y queda en bitacora.
      await as({ id, role: "authenticated" }, (q) => q("select public.complete_password_change()"));
      const after = await as("postgres", (q) =>
        q("select must_change_password from public.profiles where id=$1", [id]),
      );
      expect(after.rows[0].must_change_password).toBe(false);
      const log = await as("postgres", (q) =>
        q("select count(*)::int n from public.audit_log where action='password_changed' and entity_id=$1", [id]),
      );
      expect(log.rows[0].n).toBe(1);
    });

    it("un usuario desactivado pierde acceso a los datos", async () => {
      const id = randomUUID();
      await as("postgres", (q) => q("insert into auth.users (id,email) values ($1,'baja@esc.test')", [id]));
      await as(B1, (q) => q("select public.admin_create_profile($1,'Baja','baja@esc.test','vendedor')", [id]));
      const actor: Actor = { id, role: "authenticated" };
      // Con la contrasena temporal vigente la BD no entrega datos.
      expect((await as(actor, (q) => q("select * from public.customers"))).rowCount).toBe(0);
      expect(await failure(as(actor, (q) => q("select public.log_event('logout','profiles','x')")))).toMatch(/No autorizado/);
      await as(actor, (q) => q("select public.complete_password_change()"));
      expect((await as(actor, (q) => q("select * from public.customers"))).rowCount).toBeGreaterThan(0);
      await as(B1, (q) => q("select public.admin_set_user_active($1,false)", [id]));
      expect((await as(actor, (q) => q("select * from public.customers"))).rowCount).toBe(0);
      expect(await failure(as(actor, (q) => q("select public.touch_login()")))).toMatch(/inactivo/);
      await as(B1, (q) => q("select public.admin_set_user_active($1,true)", [id]));
      await as(actor, (q) => q("select public.touch_login()"));
    });

    it("no se puede desactivar al ultimo comprador activo ni a uno mismo", async () => {
      expect(await failure(as(B1, (q) => q("select public.admin_set_user_active($1,false)", [buyer1])))).toMatch(
        /propio usuario/,
      );
      // Con dos compradores activos se puede desactivar uno; el otro queda protegido.
      await as(B1, (q) => q("select public.admin_set_user_active($1,false)", [buyer2]));
      const msg = await failure(
        as("postgres", (q) => q("update public.profiles set activo=false where id=$1", [buyer1])),
      );
      expect(msg).toMatch(/al menos un comprador/);
      await as(B1, (q) => q("select public.admin_set_user_active($1,true)", [buyer2]));
    });

    it("anon no puede leer ni ejecutar nada", async () => {
      expect(await failure(as(ANON, (q) => q("select * from public.profiles")))).toMatch(/permission denied/);
      expect(await failure(as(ANON, (q) => q("select public.next_folio('x')")))).toMatch(/permission denied/);
    });

    it("authenticated no puede quemar folios", async () => {
      expect(await failure(as(S1, (q) => q("select public.next_folio('x')")))).toMatch(/permission denied/);
    });
  });

  describe("solicitud y flujo completo", () => {
    it("el vendedor crea un borrador con partidas y referencias", async () => {
      await as(S1, async (q) => {
        const r = await q(
          "insert into public.quote_requests (vendedor_id, customer_id) values ($1,$2) returning id",
          [seller1, customerId],
        );
        requestId = r.rows[0].id;
        const i = await q(
          `insert into public.quote_items (request_id, posicion, producto, descripcion, cantidad, unidad)
           values ($1,1,'Guante','Guante de carnaza para soldador',10,'par') returning id`,
          [requestId],
        );
        itemId = i.rows[0].id;
        const i2 = await q(
          `insert into public.quote_items (request_id, posicion, producto, descripcion, talla)
           values ($1,2,'Casco','Casco de seguridad dielectrico','M') returning id`,
          [requestId],
        );
        item2Id = i2.rows[0].id;
        await q("insert into public.item_references (item_id, tipo, url) values ($1,'link','https://example.com/g')", [itemId]);
      });
    });

    it("no deja enviar si falta una referencia, descripcion o cantidad/talla", async () => {
      const due = new Date(Date.now() + 5 * 86400_000).toISOString();
      const submit = () =>
        as(S1, (q) => q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [requestId, due]));
      expect(await failure(submit())).toMatch(/referencia/);
      await as(S1, (q) =>
        q("insert into public.item_references (item_id, tipo, url) values ($1,'imagen',$2)", [
          item2Id,
          `${requestId}/${item2Id}/a.png`,
        ]),
      );
      await as(S1, (q) => q("update public.quote_items set descripcion='corta' where id=$1", [item2Id]));
      expect(await failure(submit())).toMatch(/10 caracteres/);
      await as(S1, (q) =>
        q("update public.quote_items set descripcion='Casco de seguridad dielectrico', talla=null where id=$1", [item2Id]),
      );
      expect(await failure(submit())).toMatch(/cantidad o talla/);
      await as(S1, (q) => q("update public.quote_items set talla='M' where id=$1", [item2Id]));
    });

    it("rechaza un due_at menor al plazo (el vendedor no puede acortar ni inventar)", async () => {
      const soon = new Date(Date.now() + 3600_000).toISOString();
      expect(
        await failure(
          as(S1, (q) => q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [requestId, soon])),
        ),
      ).toMatch(/fuera del rango/);
    });

    it("el comprador no ve borradores", async () => {
      const r = await as(B1, (q) => q("select id from public.quote_requests where id=$1", [requestId]));
      expect(r.rowCount).toBe(0);
    });

    it("envia la solicitud y asigna folios consecutivos", async () => {
      const due = new Date(Date.now() + 5 * 86400_000).toISOString();
      await as(S1, (q) => q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [requestId, due]));
      const r = await as(B1, (q) =>
        q(
          `select r.folio rf, i.folio, i.estado from public.quote_requests r
             join public.quote_items i on i.request_id=r.id where r.id=$1 order by i.posicion`,
          [requestId],
        ),
      );
      const year = new Date().getFullYear();
      expect(r.rows[0].rf).toMatch(new RegExp(`^COT-${year}-\\d{4}$`));
      expect(r.rows[0].folio).toBe(`${r.rows[0].rf}-01`);
      expect(r.rows[1].folio).toBe(`${r.rows[0].rf}-02`);
      expect(r.rows.every((x) => x.estado === "pendiente")).toBe(true);
      const n = await as(B1, (q) => q("select count(*)::int n from public.notifications where tipo='nueva_solicitud'"));
      expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    it("una solicitud enviada ya no se edita ni acepta partidas ni referencias", async () => {
      // RLS: el vendedor ya no ve filas editables, el UPDATE afecta 0 filas.
      const upd = await as(S1, (q) => q("update public.quote_items set producto='X' where id=$1", [itemId]));
      expect(upd.rowCount).toBe(0);
      const upd2 = await as(S1, (q) => q("update public.quote_requests set notas='X' where id=$1", [requestId]));
      expect(upd2.rowCount).toBe(0);
      expect(
        await failure(as(S1, (q) => q("insert into public.quote_items (request_id, producto, descripcion) values ($1,'x','xxxxxxxxxxxx')", [requestId]))),
      ).toMatch(/row-level security|No se pueden agregar/);
      expect(
        await failure(
          as("postgres", (q) => q("update public.quote_items set producto='X' where id=$1", [itemId])),
        ),
      ).toMatch(/no se puede modificar/);
      expect(
        await failure(
          as("postgres", (q) =>
            q("insert into public.item_references (item_id,tipo,url) values ($1,'link','https://a.com')", [itemId]),
          ),
        ),
      ).toMatch(/no se pueden modificar/);
      expect(
        await failure(as("postgres", (q) => q("update public.quote_requests set notas='x' where id=$1", [requestId]))),
      ).toMatch(/no se puede modificar/);
    });

    it("otro vendedor no ve la solicitud", async () => {
      expect((await as(S2, (q) => q("select * from public.quote_requests"))).rowCount).toBe(0);
      expect((await as(S2, (q) => q("select * from public.quote_items"))).rowCount).toBe(0);
    });

    it("un vendedor no puede responder", async () => {
      expect(
        await failure(respond(S1, itemId, "not_found", { nota: "no" })),
      ).toMatch(/No autorizado/);
    });

    it("No encontrada exige nota y es editable; luego se puede cotizar", async () => {
      expect(await failure(as(B1, (q) => q(`select public.respond_item($1,'not_found','{"nota":"  "}')`, [itemId])))).toMatch(
        /nota es obligatoria/,
      );
      await respond(B1, itemId, "not_found", { nota: "sin proveedor", response_hours: 3.5 });
      await respond(B2, itemId, "not_found", { nota: "sigue sin existir", response_hours: 9 });
      const r = await as(S1, (q) =>
        q("select estado, not_found_note, response_business_hours::float h from public.quote_items where id=$1", [itemId]),
      );
      // first_response y horas de la PRIMERA respuesta se conservan.
      expect(r.rows[0]).toEqual({ estado: "no_encontrada", not_found_note: "sigue sin existir", h: 3.5 });
      await respondQuoted(B1, itemId, "100", null);
      const after = await as(S1, (q) =>
        q("select estado, response_business_hours::float h from public.quote_items where id=$1", [itemId]),
      );
      expect(after.rows[0]).toEqual({ estado: "cotizada", h: 3.5 });
      const notif = await as(S1, (q) => q("select tipo from public.notifications where user_id=$1", [seller1]));
      expect(notif.rows.map((x) => x.tipo)).toContain("partida_recotizada");
    });

    it("PRIVACIDAD: el vendedor no ve costo, base, proveedor ni factores", async () => {
      expect((await as(S1, (q) => q("select * from public.item_costs"))).rowCount).toBe(0);
      expect((await as(S1, (q) => q("select * from public.pricing_config"))).rowCount).toBe(0);
      expect((await as(S1, (q) => q("select * from public.audit_log"))).rowCount).toBe(0);
      const quote = await as(S1, (q) => q("select * from public.item_quotes where item_id=$1", [itemId]));
      expect(quote.rowCount).toBe(1);
      expect(Object.keys(quote.rows[0])).not.toEqual(expect.arrayContaining(["costo", "base", "proveedor"]));
      expect(quote.rows[0].price_5).toBe("121.68");
      expect((await as(B1, (q) => q("select * from public.item_costs"))).rowCount).toBe(1);
    });

    it("BLOQUEO: una cotizada no se puede editar ni borrar (ni siquiera por el administrador)", async () => {
      for (const actor of [B1, "postgres" as Actor]) {
        for (const sql of [
          "update public.item_quotes set price_1 = 1",
          "delete from public.item_quotes",
          "update public.item_costs set costo = 1",
          "delete from public.item_costs",
        ]) {
          expect(await failure(as(actor, (q) => q(sql)))).toMatch(/inmutable|permission denied/);
        }
      }
      expect(await failure(respondQuoted(B1, itemId, "50", null))).toMatch(/ya esta cotizada/);
      expect(await failure(respond(B1, itemId, "not_found", { nota: "x" }))).toMatch(
        /ya esta cotizada/,
      );
    });

    it("la BD rechaza precios que no cuadran con el tabulador o factores falsos", async () => {
      const base = quotePayload("100", null);
      const wrong = { ...base, prices: { ...base.prices, p5: "999.99" } };
      expect(await failure(respond(B1, item2Id, "quote", wrong))).toMatch(/no coinciden con el tabulador/);
      const fake = quotePayload("100", null, { ...FACTORS, p5: 1 });
      expect(await failure(respond(B1, item2Id, "quote", fake))).toMatch(/factores no coinciden/);
      expect(await failure(respond(B1, item2Id, "inventada", {}))).toMatch(/Accion invalida/);
      // Una falla no deja filas a medias.
      const left = await as("postgres", (q) => q("select count(*)::int n from public.item_costs where item_id=$1", [item2Id]));
      expect(left.rows[0].n).toBe(0);
    });

    it("el vendedor elige un precio y marca Enviado al cliente", async () => {
      expect(await failure(as(S2, (q) => q("select public.mark_item_dispatched($1,3)", [itemId])))).toMatch(
        /No autorizado/,
      );
      expect(await failure(as(S1, (q) => q("select public.mark_item_dispatched($1,6)", [itemId])))).toMatch(
        /5 precios/,
      );
      expect(await failure(as(S1, (q) => q("select public.mark_item_dispatched($1,2)", [item2Id])))).toMatch(
        /no esta lista/,
      );
      await as(S1, (q) => q("select public.mark_item_dispatched($1,3)", [itemId]));
      const d = await as(S1, (q) => q("select precio_elegido, valor::text from public.item_dispatch where item_id=$1", [itemId]));
      expect(d.rows[0]).toEqual({ precio_elegido: 3, valor: "140.40" });
      expect(await failure(as(S1, (q) => q("select public.mark_item_dispatched($1,3)", [itemId])))).toMatch(
        /no esta lista/,
      );
      expect(await failure(as("postgres", (q) => q("update public.item_dispatch set precio_elegido=1")))).toMatch(
        /inmutable/,
      );
    });

    it("maquina de estados: no se puede retroceder", async () => {
      expect(
        await failure(as("postgres", (q) => q("update public.quote_items set estado='pendiente' where id=$1", [itemId]))),
      ).toMatch(/Transicion/);
    });
  });

  describe("bitacora", () => {
    it("es solo insercion (incluso para superusuario)", async () => {
      expect(await failure(as("postgres", (q) => q("update public.audit_log set action='x'")))).toMatch(/inmutable/);
      expect(await failure(as("postgres", (q) => q("delete from public.audit_log")))).toMatch(/inmutable/);
      expect(await failure(as("postgres", (q) => q("truncate public.audit_log")))).toMatch(/inmutable/);
      expect(await failure(as(B1, (q) => q("delete from public.audit_log")))).toMatch(/permission denied/);
    });

    it("registra usuario, accion, valor anterior y nuevo", async () => {
      const r = await as(B1, (q) =>
        q(
          `select user_id, action, old_value, new_value from public.audit_log
            where entity='quote_items' and entity_id=$1 and action='update'
              and new_value ? 'estado' order by id`,
          [itemId],
        ),
      );
      expect(r.rowCount).toBeGreaterThan(0);
      const last = r.rows.at(-1);
      expect(last.new_value.estado).toBe("enviada_cliente");
      expect(last.old_value.estado).toBe("cotizada");
      expect(last.user_id).toBe(seller1);
    });

    it("el comprador registra copy_price_table sin guardar contenido; acciones fuera de lista se rechazan", async () => {
      await as(S1, (q) =>
        q("select public.log_event('copy_price_table','quote_items',$1,'{\"scope\":\"item\"}')", [itemId]),
      );
      expect(await failure(as(S1, (q) => q("select public.log_event('borrar_todo','x','1')")))).toMatch(
        /no permitida/,
      );
    });

    it("los cambios de configuracion del tabulador quedan como historial inmutable", async () => {
      await as(B1, (q) =>
        q("insert into public.pricing_config (p5, created_by) values (1.20, $1)", [buyer1]),
      );
      expect(await failure(as(B1, (q) => q("update public.pricing_config set p5 = 1")))).toMatch(/permission denied|inmutable/);
      expect(await failure(as(S1, (q) => q("insert into public.pricing_config (p5, created_by) values (1,$1)", [seller1])))).toMatch(
        /row-level security|permission denied/,
      );
      // Una cotizacion con los factores anteriores ya no es valida: debe recargar.
      expect(await failure(respondQuoted(B1, item2Id, "100", null))).toMatch(/factores no coinciden/);
      await as("postgres", (q) => q("alter table public.pricing_config disable trigger pricing_config_immutable"));
      await as("postgres", (q) => q("delete from public.pricing_config where id = (select max(id) from public.pricing_config)"));
      await as("postgres", (q) => q("alter table public.pricing_config enable trigger pricing_config_immutable"));
    });
  });

  describe("save_draft y versiones de cotizacion", () => {
    const rid = randomUUID();
    const i1 = randomUUID();
    const i2 = randomUUID();
    const ref1 = randomUUID();
    const draft = (items: unknown[], extra: Record<string, unknown> = {}) =>
      JSON.stringify({ request_id: rid, customer_id: customerId, notas: "n", items, ...extra });
    const item = (id: string, over: Record<string, unknown> = {}) => ({
      id, producto: "Taladro", descripcion: "Taladro percutor de 1/2", cantidad: 2, unidad: "pieza", refs: [], ...over,
    });

    it("guarda un borrador incompleto (permitido) y es idempotente", async () => {
      const payload = draft([item(i1, { producto: "", descripcion: "", refs: [] }), item(i2, { refs: [{ id: ref1, tipo: "link", url: "https://a.com/x" }] })]);
      await as(S1, (q) => q("select public.save_draft($1::jsonb)", [payload]));
      await as(S1, (q) => q("select public.save_draft($1::jsonb)", [payload]));
      const r = await as(S1, (q) => q("select count(*)::int n from public.quote_items where request_id=$1", [rid]));
      expect(r.rows[0].n).toBe(2);
      const refs = await as(S1, (q) => q("select count(*)::int n from public.item_references where item_id=$1", [i2]));
      expect(refs.rows[0].n).toBe(1);
    });

    it("quita partidas y referencias que ya no vienen en el payload", async () => {
      await as(S1, (q) => q("select public.save_draft($1::jsonb)", [draft([item(i2, { refs: [] })])]));
      const r = await as(S1, (q) => q("select id from public.quote_items where request_id=$1", [rid]));
      expect(r.rows.map((x) => x.id)).toEqual([i2]);
      expect((await as(S1, (q) => q("select * from public.item_references where item_id=$1", [i2]))).rowCount).toBe(0);
    });

    it("otro vendedor no puede escribir sobre ese borrador", async () => {
      expect(await failure(as(S2, (q) => q("select public.save_draft($1::jsonb)", [draft([item(i2)])])))).toMatch(
        /row-level security/,
      );
      expect((await as(S2, (q) => q("select * from public.quote_requests where id=$1", [rid]))).rowCount).toBe(0);
    });

    it("un comprador no puede crear borradores", async () => {
      expect(await failure(as(B1, (q) => q("select public.save_draft($1::jsonb)", [draft([item(randomUUID())]).replace(rid, randomUUID())])))).toMatch(
        /row-level security/,
      );
    });

    it("no se puede guardar sobre una solicitud ya enviada", async () => {
      await as(S1, (q) => q("select public.save_draft($1::jsonb)", [draft([item(i2, { refs: [{ id: randomUUID(), tipo: "link", url: "https://a.com/y" }] })])]));
      const due = new Date(Date.now() + 5 * 86400_000).toISOString();
      await as(S1, (q) => q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [rid, due]));
      expect(await failure(as(S1, (q) => q("select public.save_draft($1::jsonb)", [draft([item(i2)])])))).toMatch(
        /row-level security|no se puede/,
      );
    });

    it("las cotizaciones son versionadas: v1 por respond_item, v2 solo sobre cotizada y en orden", async () => {
      await respondQuoted(B1, i2, "100", null);
      const v = await as(S1, (q) => q("select version from public.item_quotes where item_id=$1", [i2]));
      expect(v.rows).toEqual([{ version: 1 }]);
      const insertV = (version: number) =>
        as("postgres", async (q) => {
          await q("select set_config('request.jwt.claim.role','service_role', true)");
          await q(
            `insert into public.item_costs (item_id, version, costo, base, factors_snapshot, created_by)
             select $1, $2, 200, 0, factors_snapshot, created_by from public.item_costs where item_id=$1 and version=1`,
            [i2, version],
          );
          await q(
            `insert into public.item_quotes (item_id, version, moneda, price_1, price_2, price_3, price_4, price_5, entrega_dias, entrega_tipo, quoted_by)
             select $1, $2, 'MXN', 320.32, 297.44, 280.80, 262.08, 243.36, 5, 'habiles', quoted_by from public.item_quotes where item_id=$1 and version=1`,
            [i2, version],
          );
        });
      expect(await failure(insertV(3))).toMatch(/Version de cotizacion invalida/);
      await insertV(2);
      // Cada version queda intacta y bloqueada; el vendedor ve las versiones sin costos.
      expect((await as(S1, (q) => q("select * from public.item_quotes where item_id=$1", [i2]))).rowCount).toBe(2);
      expect(await failure(as("postgres", (q) => q("update public.item_quotes set price_1=1 where version=1")))).toMatch(/inmutable/);
      // El envio al cliente usa la version vigente (2).
      await as(S1, (q) => q("select public.mark_item_dispatched($1,1)", [i2]));
      const d = await as(S1, (q) => q("select quote_version, valor::text from public.item_dispatch where item_id=$1", [i2]));
      expect(d.rows[0]).toEqual({ quote_version: 2, valor: "320.32" });
    });
  });

  describe("paridad tabulador TS vs BD", () => {
    it("los precios calculados en TS son aceptados por el trigger de la BD (casos limite)", async () => {
      const cases: [string, string | null][] = [
        ["100", null], ["100", "10"], ["10.01", null], ["0.01", null], ["1.15", "0.0001"],
        ["999999.9999", "12345.6789"], ["33.3333", null], ["0.005", null], ["7.8125", null],
      ];
      for (const [cost, ship] of cases) {
        const id = await newPendingItem();
        await respondQuoted(B1, id, cost, ship);
        const row = await as("postgres", (q) => q("select base::text from public.item_costs where item_id=$1", [id]));
        const expectedBase = ship && Number(ship) > 0 ? Number(cost) + Number(ship) : Number(cost) * 1.04;
        expect(Number(row.rows[0].base)).toBeCloseTo(expectedBase, 6);
      }
    });
  });
});

async function newPendingItem(): Promise<string> {
  const due = new Date(Date.now() + 5 * 86400_000).toISOString();
  return as(S1, async (q) => {
    const r = await q("insert into public.quote_requests (vendedor_id, customer_id) values ($1,$2) returning id", [
      seller1,
      customerId,
    ]);
    const i = await q(
      `insert into public.quote_items (request_id, producto, descripcion, cantidad, unidad)
       values ($1,'P','Descripcion suficiente',1,'pieza') returning id`,
      [r.rows[0].id],
    );
    await q("insert into public.item_references (item_id,tipo,url) values ($1,'link','https://a.com')", [i.rows[0].id]);
    await q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [r.rows[0].id, due]);
    return i.rows[0].id as string;
  });
}
