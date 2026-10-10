import { randomUUID } from "node:crypto";
import { calcTabulador } from "@/lib/pricing/tabulador";
import { as, type Actor } from "./helpers";

export interface World {
  seller1: Actor; seller2: Actor; buyer1: Actor; buyer2: Actor;
  ids: { s1: string; s2: string; b1: string; b2: string };
  customerId: string;
}

/** Crea 2 vendedores, 2 compradores y un cliente nuevos (los datos persisten entre archivos). */
export async function createWorld(): Promise<World> {
  const ids = { s1: randomUUID(), s2: randomUUID(), b1: randomUUID(), b2: randomUUID() };
  let customerId = "";
  await as("postgres", async (q) => {
    for (const [id, nombre, rol] of [
      [ids.s1, "Vend A", "vendedor"], [ids.s2, "Vend B", "vendedor"],
      [ids.b1, "Comp A", "comprador"], [ids.b2, "Comp B", "comprador"],
    ]) {
      await q("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
      await q("insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)",
        [id, `${nombre} ${id.slice(0, 4)}`, `${id}@esc.test`, rol]);
    }
    const c = await q("insert into public.customers (nombre) values ($1) returning id", [`Cliente ${randomUUID().slice(0, 8)}`]);
    customerId = c.rows[0].id;
  });
  const a = (id: string): Actor => ({ id, role: "authenticated" });
  return { seller1: a(ids.s1), seller2: a(ids.s2), buyer1: a(ids.b1), buyer2: a(ids.b2), ids, customerId };
}

export const FACTORS = { no_shipping_markup: 0.04, p5: 1.17, p4: 1.26, p3: 1.35, p2: 1.43, p1: 1.54 };

export async function currentFactors() {
  const r = await as("postgres", (q) => q("select no_shipping_markup::float, p1::float, p2::float, p3::float, p4::float, p5::float from public.pricing_config order by id desc limit 1"));
  return r.rows[0] as typeof FACTORS;
}

export function quotePayload(cost: string, shipping: string | null, factors: typeof FACTORS, extra: Record<string, unknown> = {}) {
  const t = calcTabulador(cost, shipping, {
    noShippingMarkup: factors.no_shipping_markup, p1: factors.p1, p2: factors.p2, p3: factors.p3, p4: factors.p4, p5: factors.p5,
  });
  return {
    costo: cost, envio: shipping, moneda: "MXN", factors,
    prices: { p1: t.p1, p2: t.p2, p3: t.p3, p4: t.p4, p5: t.p5 },
    entrega: { dias: 5, tipo: "habiles" }, compra_min: { cantidad: 1, unidad: "pieza" }, proveedor: "ACME", nota: "nota", response_hours: 2, ...extra,
  };
}

export const respond = (actor: Actor, item: string, action: string, payload: unknown) =>
  as(actor, (q) => q("select public.respond_item($1,$2,$3::jsonb)", [item, action, JSON.stringify(payload)]));

/** Solicitud enviada con una partida pendiente. */
export async function newPendingItem(w: World, producto = "Producto de prueba", seller: Actor = w.seller1): Promise<{ request: string; item: string }> {
  const due = new Date(Date.now() + 5 * 86400_000).toISOString();
  return as(seller, async (q) => {
    const r = await q("insert into public.quote_requests (id, vendedor_id, customer_id) values (gen_random_uuid(), $1, $2) returning id",
      [seller === w.seller1 ? w.ids.s1 : w.ids.s2, w.customerId]);
    const i = await q(
      `insert into public.quote_items (request_id, producto, descripcion, cantidad, unidad) values ($1,$2,'Descripcion suficiente',4,'pieza') returning id`,
      [r.rows[0].id, producto]);
    await q("insert into public.item_references (item_id,tipo,url) values ($1,'link','https://a.com')", [i.rows[0].id]);
    await q("update public.quote_requests set estado='enviada', due_at=$2 where id=$1", [r.rows[0].id, due]);
    return { request: r.rows[0].id as string, item: i.rows[0].id as string };
  });
}

export async function newQuotedItem(w: World, producto = "Producto de prueba", cost = "100", extra: Record<string, unknown> = {}, seller: Actor = w.seller1) {
  const x = await newPendingItem(w, producto, seller);
  await respond(w.buyer1, x.item, "quote", quotePayload(cost, null, await currentFactors(), extra));
  return x;
}

/** Simula el paso del tiempo: la vigencia de la version indicada ya vencio (excepcion de prueba al bloqueo). */
export async function expireQuote(item: string, version = 1) {
  await as("postgres", async (q) => {
    await q("alter table public.item_quotes disable trigger item_quotes_locked");
    await q("update public.item_quotes set valid_until = now() - interval '1 day' where item_id=$1 and version=$2", [item, version]);
    await q("alter table public.item_quotes enable trigger item_quotes_locked");
  });
}

export const dueIn48 = () => new Date(Date.now() + 3 * 86400_000).toISOString();
