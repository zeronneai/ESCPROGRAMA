import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld, type World } from "./fixtures";

let w: World;
let aux: Actor;
let auxId: string;
let jefa: Actor;
const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

async function venta(seller: Actor, customer: string, factura: string, monto: number, cobrada = true): Promise<string> {
  const id = (await q(seller, "insert into public.ventas (customer_id, monto, pago, factura) values ($1,$2,'contado',$3) returning id", [customer, monto, factura])).rows[0].id;
  if (cobrada) await q(seller, "update public.ventas set porcentaje_cobrado=100, fecha_cobro=public.local_today() where id=$1", [id]);
  return id;
}

export function recepcionSuite() {
  describe.skipIf(!DATABASE_URL)("Recepcion de facturas (finanzas)", () => {
    beforeAll(async () => {
      w = await createWorld();
      auxId = randomUUID();
      await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [auxId, `${auxId}@esc.test`]);
      await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,'Aux Finanzas',$2,'aux_finanzas',false)", [auxId, `${auxId}@esc.test`]);
      aux = { id: auxId, role: "authenticated" };
      const jefaId = randomUUID();
      await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [jefaId, `${jefaId}@esc.test`]);
      await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,'Jefa Com',$2,'jefe_ventas',false)", [jefaId, `${jefaId}@esc.test`]);
      jefa = { id: jefaId, role: "authenticated" };
    });

    it("el vendedor entrega facturas cobradas agrupadas por pago; finanzas recibe, rechaza y anota", async () => {
      const tag = randomUUID().slice(0, 6);
      const a = await venta(w.seller1, w.customerId, `RA-${tag}`, 4000);
      const b = await venta(w.seller1, w.customerId, `RB-${tag}`, 6000);
      const c = await venta(w.seller1, w.customerId, `RC-${tag}`, 1500);
      const sinCobrar = await venta(w.seller1, w.customerId, `RD-${tag}`, 100, false);
      const ajena = await venta(w.seller2, w.customerId, `RE-${tag}`, 100);
      const pago = (ventas: string[], monto: number) => ({ fecha: "2026-11-20", monto, forma: "transferencia", referencia: "SPEI 123", ventas });
      const entregar = (actor: Actor, pagos: unknown[]) => q(actor, "select public.facturas_entregar($1::jsonb) as id", [JSON.stringify({ notas: "Traigo 3", pagos })]);

      expect(await failure(entregar(w.seller1, [pago([sinCobrar], 100)]))).toMatch(/no esta cobrada/);
      expect(await failure(entregar(w.seller1, [pago([ajena], 100)]))).toMatch(/no es tuya/);
      expect(await failure(entregar(w.seller1, [pago([a], 10), pago([a], 10)]))).toMatch(/dos pagos/);
      expect(await failure(entregar(aux, [pago([a], 10)]))).toMatch(/Solo los vendedores/);

      // Un pago de 10,000 cubre dos facturas y otro cubre la tercera
      const ent = (await entregar(w.seller1, [pago([a, b], 10000), pago([c], 1500)])).rows[0].id;
      expect(await failure(entregar(w.seller1, [pago([a], 4000)]))).toMatch(/ya se entrego/);
      const pagos = await q(w.seller1, "select monto::numeric, (select count(*)::int from public.factura_recepcion r where r.pago_id=p.id) n from public.cobro_pagos p where entrega_id=$1 order by monto", [ent]);
      expect(pagos.rows.map((r) => [Number(r.monto), r.n])).toEqual([[1500, 1], [10000, 2]]);
      expect((await q(aux, "select count(*)::int n from public.notifications where user_id=$1 and ref_id=$2", [auxId, ent])).rows[0].n).toBe(1);

      // Otro vendedor no lo ve; finanzas ve las ventas y el cliente
      expect((await q(w.seller2, "select id from public.factura_recepcion where entrega_id=$1", [ent])).rowCount).toBe(0);
      const vista = await q(aux, "select r.id, v.factura, c.nombre from public.factura_recepcion r join public.ventas v on v.id=r.venta_id join public.customers c on c.id=v.customer_id where r.entrega_id=$1 order by v.factura", [ent]);
      expect(vista.rows.map((r) => r.factura)).toEqual([`RA-${tag}`, `RB-${tag}`, `RC-${tag}`]);
      expect((await q(aux, "select count(*)::int n from public.finanzas_vendedores() where id=$1 and por_revisar=3", [w.ids.s1])).rows[0].n).toBe(1);

      const [ra, rb, rc] = vista.rows.map((r) => r.id as string);
      expect(await failure(q(w.seller1, "select public.factura_revisar($1,'recibida')", [ra]))).toMatch(/Solo finanzas/);
      expect(await failure(q(aux, "update public.factura_recepcion set estado='recibida' where id=$1", [ra]))).toMatch(/permission denied/);
      await q(aux, "select public.factura_revisar($1,'recibida')", [ra]);
      await q(aux, "select public.factura_revisar($1,'recibida')", [rb]);
      expect(await failure(q(aux, "select public.factura_revisar($1,'rechazada')", [rc]))).toMatch(/por que se rechaza/);
      await q(aux, "select public.factura_revisar($1,'rechazada','No vino la factura fisica')", [rc]);
      const e = (await q(w.seller1, "select estado from public.factura_entregas where id=$1", [ent])).rows[0];
      expect(e.estado).toBe("revisada");
      expect((await q(w.seller1, "select count(*)::int n from public.notifications where user_id=$1 and ref_id=$2 and titulo like '%rechazo%'", [w.ids.s1, ent])).rows[0].n).toBe(1);

      // Anotacion de finanzas y respuesta del vendedor
      await q(aux, "select public.factura_entrega_nota($1,'Trajo la factura X-99 que no esta en la lista')", [ent]);
      await q(w.seller1, "select public.factura_entrega_nota($1,'Va en la siguiente entrega')", [ent]);
      expect(await failure(q(w.seller2, "select public.factura_entrega_nota($1,'x')", [ent]))).toMatch(/No autorizado/);
      const notas = await q(w.seller1, "select autor_nombre, texto from public.factura_entrega_notas where entrega_id=$1 order by created_at", [ent]);
      expect(notas.rows).toHaveLength(2);
      expect(notas.rows[0].autor_nombre).toBe("Aux Finanzas");

      // La rechazada se puede volver a entregar
      const ent2 = (await entregar(w.seller1, [pago([c], 1500)])).rows[0].id;
      expect(ent2).toBeTruthy();
      expect(await failure(q(aux, "select public.factura_revisar($1,'recibida')", [rc]))).toMatch(/ya se volvio a entregar/);
    });
    it("tipo de cambio: la venta en USD toma el de la factura o el oficial del dia (DOF = FIX del dia habil anterior)", async () => {
      await q("postgres", "insert into public.tipos_cambio (fecha, usd_mxn, fuente) values ('2026-11-19', 18.1000, 'banxico'), ('2026-11-20', 18.2000, 'banxico') on conflict (fecha) do update set usd_mxn = excluded.usd_mxn, fuente = excluded.fuente");
      // Sin tipo de cambio en la factura: el del dia habil anterior a su fecha
      const v1 = (await q(w.seller1, "insert into public.ventas (customer_id, monto, moneda, pago, fecha) values ($1, 100, 'USD', 'contado', '2026-11-21') returning id, tipo_cambio::numeric tc, tipo_cambio_fuente f", [w.customerId])).rows[0];
      expect([Number(v1.tc), v1.f]).toEqual([18.2, "banxico"]);
      // La factura trae el suyo: manda ese
      await q(w.seller1, "select public.venta_tipo_cambio_factura($1, 17.95)", [v1.id]);
      const v1b = (await q(w.seller1, "select tipo_cambio::numeric tc, tipo_cambio_fuente f from public.ventas where id=$1", [v1.id])).rows[0];
      expect([Number(v1b.tc), v1b.f]).toEqual([17.95, "factura"]);
      expect(await failure(q(w.seller2, "select public.venta_tipo_cambio_factura($1, 17)", [v1.id]))).toMatch(/No autorizado/);
      // En pesos no lleva tipo de cambio
      const v2 = (await q(w.seller1, "insert into public.ventas (customer_id, monto, moneda, pago) values ($1, 100, 'MXN', 'contado') returning tipo_cambio", [w.customerId])).rows[0];
      expect(v2.tipo_cambio).toBeNull();
      // Venta vieja sin tipo de cambio: se llena cuando el portal baja los tipos de cambio
      await q("postgres", "delete from public.tipos_cambio where fecha between '2026-09-20' and '2026-10-06'");
      const v3 = (await q(w.seller1, "insert into public.ventas (customer_id, monto, moneda, pago, fecha) values ($1, 50, 'USD', 'contado', '2026-10-06') returning id, tipo_cambio", [w.customerId])).rows[0];
      expect(v3.tipo_cambio).toBeNull();
      expect((await q("postgres", "select public.tipo_cambio_pendiente_desde() d")).rows[0].d).toBeTruthy();
      await q("postgres", "insert into public.tipos_cambio (fecha, usd_mxn, fuente) values ('2026-10-05', 19.0000, 'referencia') on conflict (fecha) do update set usd_mxn = excluded.usd_mxn, fuente = excluded.fuente");
      expect(Number((await q("postgres", "select public.ventas_rellenar_tipo_cambio() n")).rows[0].n)).toBeGreaterThanOrEqual(1);
      const v3b = (await q(w.seller1, "select tipo_cambio::numeric tc, tipo_cambio_fuente f from public.ventas where id=$1", [v3.id])).rows[0];
      expect([Number(v3b.tc), v3b.f]).toEqual([19, "referencia"]);
      // Los usuarios no escriben tipos de cambio
      expect(await failure(q(w.seller1, "insert into public.tipos_cambio (fecha, usd_mxn) values ('2026-01-02', 17)"))).toMatch(/permission denied|row-level/);
    });
    it("comisiones: % por articulo, obligatorio para marcarla pagada; despues solo la jefa lo cambia", async () => {
      const v = (await q(w.seller1, "insert into public.ventas (customer_id, monto, pago, factura) values ($1, 1160, 'contado', 'COM-1') returning id", [w.customerId])).rows[0].id;
      const l1 = (await q(w.seller1, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1, 'Guante', 10) returning id", [v])).rows[0].id;
      const l2 = (await q(w.seller1, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1, 'Bata', 2) returning id", [v])).rows[0].id;
      // Sin comision no se marca pagada
      expect(await failure(q(w.seller1, "update public.ventas set porcentaje_cobrado=100, fecha_cobro=public.local_today() where id=$1", [v]))).toMatch(/COMISION_FALTA/);
      // Parcial si se puede
      await q(w.seller1, "update public.ventas set porcentaje_cobrado=50 where id=$1", [v]);
      expect(await failure(q(w.seller2, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l1, importe: 1, comision_pct: 1 }])]))).toMatch(/No autorizado/);
      expect(await failure(q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l1, importe: 600, comision_pct: 120 }])]))).toMatch(/0 a 100/);
      await q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l1, importe: 600, comision_pct: 3 }])]);
      expect(await failure(q(w.seller1, "update public.ventas set porcentaje_cobrado=100, fecha_cobro=public.local_today() where id=$1", [v]))).toMatch(/COMISION_FALTA/);
      await q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l2, importe: 400, comision_pct: 5 }])]);
      await q(w.seller1, "update public.ventas set porcentaje_cobrado=100, fecha_cobro=public.local_today() where id=$1", [v]);
      const ls = await q(w.seller1, "select comision::numeric c from public.venta_lineas where venta_id=$1 order by comision", [v]);
      expect(ls.rows.map((r) => Number(r.c))).toEqual([18, 20]);
      // Pagada: el vendedor ya no la cambia; la jefa si
      expect(await failure(q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l1, importe: 600, comision_pct: 4 }])]))).toMatch(/solo la jefa/);
      await q(jefa, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l1, importe: 600, comision_pct: 4 }])]);
      expect(Number((await q(jefa, "select comision::numeric c from public.venta_lineas where id=$1", [l1])).rows[0].c)).toBe(24);
      // La jefa ve las comisiones de todos
      expect((await q(jefa, "select count(*)::int n from public.venta_lineas where venta_id=$1 and comision is not null", [v])).rows[0].n).toBe(2);
    });

    it("comisiones: la factura guarda el importe y el % de cada articulo", async () => {
      const datos = JSON.stringify({ folio: "CF" + randomUUID().slice(0, 6), uuid: randomUUID(), customer_id: w.customerId, pago: "contado", total: 1160, moneda: "MXN",
        lineas: [{ clave: null, descripcion: "Guante", cantidad: 1, importe: 700, comision_pct: 2.5 }, { clave: null, descripcion: "Bata", cantidad: 1, importe: 300 }] });
      const r = (await q(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos])).rows[0].r;
      const ls = await q(w.seller1, "select descripcion, importe::numeric i, comision_pct::numeric p, comision::numeric c from public.venta_lineas where venta_id=$1 order by descripcion", [r.venta_id]);
      expect(ls.rows.map((x) => [x.descripcion, Number(x.i), x.p == null ? null : Number(x.p), x.c == null ? null : Number(x.c)])).toEqual([["Bata", 300, null, null], ["Guante", 700, 2.5, 17.5]]);
    });
  });
}
