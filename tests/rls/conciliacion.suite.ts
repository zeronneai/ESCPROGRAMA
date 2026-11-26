import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld, type World } from "./fixtures";

let w: World;
let aux: Actor;
let jefa: Actor;
let gerente: Actor;
const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));
async function persona(rol: string, nombre: string): Promise<Actor> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, nombre, `${id}@esc.test`, rol]);
  return { id, role: "authenticated" };
}

export function conciliacionSuite() {
  describe.skipIf(!DATABASE_URL)("Conciliaciones bancarias", () => {
    beforeAll(async () => {
      w = await createWorld();
      aux = await persona("aux_finanzas", "Aux Conc");
      jefa = await persona("jefe_ventas", "Jefa Conc");
      gerente = await persona("gerente", "Gerente Conc");
    });

    it("finanzas sube abonos (sin repetir); el vendedor toma uno, marca pagada su factura o la deja apartada hasta subirla", async () => {
      const tag = randomUUID().slice(0, 6).toUpperCase();
      const estado = (abonos: unknown[]) => JSON.stringify({ banco: "BBVA", cuenta: "0152289" + tag.slice(0, 3), moneda: "MXN", desde: "2026-11-02", hasta: "2026-11-24", abonos });
      const a1 = { fecha: "2026-11-23", descripcion: `SPEI RECIBIDO F-${tag}1`, monto: 1160 };
      const a2 = { fecha: "2026-11-23", descripcion: `SPEI RECIBIDO F-${tag}2`, monto: 500 };
      expect(await failure(q(w.seller1, "select public.conciliacion_subir($1::jsonb)", [estado([a1])]))).toMatch(/Solo finanzas/);
      const r1 = (await q(aux, "select public.conciliacion_subir($1::jsonb) r", [estado([a1, a2])])).rows[0].r;
      expect(r1).toMatchObject({ nuevos: 2, repetidos: 0 });
      // Volver a subir el mismo estado (con uno nuevo) no repite
      const r2 = (await q(aux, "select public.conciliacion_subir($1::jsonb) r", [estado([a1, a2, { ...a2, descripcion: a2.descripcion + "X" }])])).rows[0].r;
      expect(r2).toMatchObject({ nuevos: 1, repetidos: 2 });
      expect((await q(w.seller1, "select count(*)::int n from public.notifications where user_id=$1 and tipo='conciliacion'", [w.ids.s1])).rows[0].n).toBeGreaterThanOrEqual(1);

      const m1 = (await q(w.seller1, "select id from public.conciliacion_movimientos where descripcion=$1", [a1.descripcion])).rows[0].id;
      const m2 = (await q(w.seller1, "select id from public.conciliacion_movimientos where descripcion=$1", [a2.descripcion])).rows[0].id;

      // Venta ya en la bitacora con su comision: al tomar el abono queda pagada con la fecha del abono
      const folio = `F-${tag}1`;
      const v = (await q(w.seller1, "insert into public.ventas (customer_id, monto, pago, factura, fecha) values ($1, 1160, 'contado', $2, '2026-11-20') returning id", [w.customerId, folio])).rows[0].id;
      const l = (await q(w.seller1, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1,'Guante',1) returning id", [v])).rows[0].id;
      // Sin comision no la deja tomar (la venta no se puede marcar pagada)
      expect(await failure(q(w.seller1, "select public.conciliacion_tomar($1, $2)", [m1, [folio]]))).toMatch(/COMISION_FALTA/);
      await q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l, importe: 1000, comision_pct: 3 }])]);
      const t1 = (await q(w.seller1, "select public.conciliacion_tomar($1, $2) r", [m1, [folio.toLowerCase()]])).rows[0].r;
      expect(t1).toEqual([{ folio, estado: "pagada", tardio: false }]);
      const vv = (await q(w.seller1, "select porcentaje_cobrado::numeric p, fecha_cobro::text f from public.ventas where id=$1", [v])).rows[0];
      expect([Number(vv.p), vv.f]).toEqual([100, "2026-11-23"]);
      // Otro vendedor ya no lo puede tomar
      expect(await failure(q(w.seller2, "select public.conciliacion_tomar($1, $2)", [m1, ["X"]]))).toMatch(/ya lo tomo/);
      // El vendedor no lo puede soltar porque ya marco pagada; la jefa si
      expect(await failure(q(w.seller1, "select public.conciliacion_soltar($1)", [m1]))).toMatch(/pidele a la jefa/);

      // Factura que todavia no sube: queda apartada; no esta en ventas (no sale en recepcion)
      const folio2 = `F-${tag}2`;
      expect((await q(w.seller1, "select public.conciliacion_tomar($1, $2) r", [m2, [folio2]])).rows[0].r).toEqual([{ folio: folio2, estado: "pendiente", tardio: false }]);
      // La suelta y la vuelve a tomar
      await q(w.seller1, "select public.conciliacion_soltar($1)", [m2]);
      await q(w.seller1, "select public.conciliacion_tomar($1, $2)", [m2, [folio2]]);
      // Sube la factura (con comision desde la factura): se liga y queda pagada con la fecha del abono
      const datos = JSON.stringify({ folio: folio2, uuid: randomUUID(), customer_id: w.customerId, pago: "contado", total: 500, moneda: "MXN", fecha: "2026-11-20",
        lineas: [{ clave: null, descripcion: "Bata", cantidad: 1, importe: 431, comision_pct: 2 }] });
      const rv = (await q(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos])).rows[0].r;
      const lig = (await q(w.seller1, "select public.conciliacion_ligar_venta($1) r", [rv.venta_id])).rows[0].r;
      expect(lig).toEqual([{ fecha: "2026-11-23", estado: "pagada" }]);
      expect(Number((await q(w.seller1, "select porcentaje_cobrado::numeric p from public.ventas where id=$1", [rv.venta_id])).rows[0].p)).toBe(100);

      // Finanzas o la jefa pueden soltar aunque ya este pagada
      await q(jefa, "select public.conciliacion_soltar($1)", [m1]);
      expect((await q(w.seller2, "select tomado_por from public.conciliacion_movimientos where id=$1", [m1])).rows[0].tomado_por).toBeNull();
      expect(await failure(q(aux, "select public.conciliacion_tomar($1, $2)", [m1, ["X"]]))).toMatch(/Solo los vendedores/);
    });

    it("factura subida sin comision: queda ligada y se marca pagada despues", async () => {
      const tag = randomUUID().slice(0, 6).toUpperCase();
      await q(aux, "select public.conciliacion_subir($1::jsonb)", [JSON.stringify({ banco: "Banregio", cuenta: "061022470" + tag.slice(0, 3), moneda: "MXN", abonos: [{ fecha: "2026-11-21", descripcion: `PAGO ${tag}`, monto: 300 }] })]);
      const m = (await q(w.seller1, "select id from public.conciliacion_movimientos where descripcion=$1", [`PAGO ${tag}`])).rows[0].id;
      await q(w.seller1, "select public.conciliacion_tomar($1, $2)", [m, [`G-${tag}`]]);
      const datos = JSON.stringify({ folio: `G-${tag}`, uuid: randomUUID(), customer_id: w.customerId, pago: "contado", total: 300, moneda: "MXN", fecha: "2026-11-20",
        lineas: [{ clave: null, descripcion: "Cofia", cantidad: 1, importe: 258 }] });
      const rv = (await q(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos])).rows[0].r;
      expect((await q(w.seller1, "select public.conciliacion_ligar_venta($1) r", [rv.venta_id])).rows[0].r).toEqual([{ fecha: "2026-11-21", estado: "falta_comision" }]);
      const fila = (await q(w.seller1, "select id from public.conciliacion_facturas where movimiento_id=$1", [m])).rows[0].id;
      const l = (await q(w.seller1, "select id from public.venta_lineas where venta_id=$1", [rv.venta_id])).rows[0].id;
      await q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [rv.venta_id, JSON.stringify([{ id: l, importe: 258, comision_pct: 2 }])]);
      expect((await q(w.seller1, "select public.conciliacion_marcar_pagada($1) r", [fila])).rows[0].r).toBe("pagada");
    });
    it("plazo de 7 dias: identificado tarde baja 10% la comision y se paga la siguiente quincena; la gerente identifica a nombre de otro", async () => {
      const tag = randomUUID().slice(0, 6).toUpperCase();
      await q(aux, "select public.conciliacion_subir($1::jsonb)", [JSON.stringify({ banco: "BBVA", cuenta: "015" + tag, moneda: "MXN", abonos: [
        { fecha: "2026-11-10", descripcion: `TARDE ${tag}`, monto: 1160 }, { fecha: "2026-11-10", descripcion: `SINUSR ${tag}`, monto: 700 }, { fecha: "2026-11-10", descripcion: `AJENO ${tag}`, monto: 900 }] })]);
      const id = async (d: string) => (await q(w.seller1, "select id from public.conciliacion_movimientos where descripcion=$1", [d])).rows[0].id;
      const mT = await id(`TARDE ${tag}`);
      const mS = await id(`SINUSR ${tag}`);
      const mA = await id(`AJENO ${tag}`);
      // Se subio hace 8 dias
      await q("postgres", "update public.conciliacion_movimientos set created_at = now() - interval '8 days' where id in ($1, $2)", [mT, mS]);
      const folio = `T-${tag}`;
      const v = (await q(w.seller1, "insert into public.ventas (customer_id, monto, pago, factura, fecha) values ($1, 1160, 'contado', $2, '2026-11-05') returning id", [w.customerId, folio])).rows[0].id;
      const l = (await q(w.seller1, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1,'Guante',1) returning id", [v])).rows[0].id;
      await q(w.seller1, "select public.venta_comisiones($1, $2::jsonb)", [v, JSON.stringify([{ id: l, importe: 1000, comision_pct: 5 }])]);
      const r = (await q(w.seller1, "select public.conciliacion_tomar($1, $2) r", [mT, [folio]])).rows[0].r;
      expect(r).toEqual([{ folio, estado: "pagada", tardio: true }]);
      const vv = (await q(w.seller1, "select comision_descuento_pct::numeric d, comision_quincena is not null q from public.ventas where id=$1", [v])).rows[0];
      expect([Number(vv.d), vv.q]).toEqual([10, true]);
      expect((await q("postgres", "select public.quincena_siguiente('2026-11-10')::text a, public.quincena_siguiente('2026-11-20')::text b")).rows[0]).toEqual({ a: "2026-11-16", b: "2026-12-01" });

      // La gerente identifica a nombre de alguien sin usuario
      expect(await failure(q(w.seller1, "select public.conciliacion_tomar($1, $2, null, 'Don Pepe')", [mS, ["X1"]]))).toMatch(/Solo la jefa de ventas, la gerente/);
      const r2 = (await q(gerente, "select public.conciliacion_tomar($1, $2, null, 'Don Pepe') r", [mS, ["X1"]])).rows[0].r;
      expect(r2).toEqual([{ folio: "X1", estado: "pendiente", tardio: true }]);
      expect((await q(gerente, "select tomado_para, vendedor_id from public.conciliacion_movimientos where id=$1", [mS])).rows[0]).toEqual({ tomado_para: "Don Pepe", vendedor_id: null });
      // ...y a nombre de un vendedor con usuario: si le falta la comision queda ligada
      const folio2 = `A-${tag}`;
      const v2 = (await q(w.seller2, "insert into public.ventas (customer_id, monto, pago, factura) values ($1, 900, 'contado', $2) returning id", [w.customerId, folio2])).rows[0].id;
      await q(w.seller2, "insert into public.venta_lineas (venta_id, descripcion, cantidad) values ($1,'Bata',1)", [v2]);
      const r3 = (await q(gerente, "select public.conciliacion_tomar($1, $2, $3) r", [mA, [folio2], w.ids.s2])).rows[0].r;
      expect(r3).toEqual([{ folio: folio2, estado: "falta_comision", tardio: false }]);
      expect((await q(w.seller2, "select count(*)::int n from public.notifications where user_id=$1 and ref_id=$2", [w.ids.s2, mA])).rows[0].n).toBe(1);
      await q(gerente, "select public.conciliacion_soltar($1)", [mA]);
    });

    it("pago identificado antes del portal: lo marca la direccion o el comprador con sus folios y nadie mas lo toca", async () => {
      const tag = randomUUID().slice(0, 6).toUpperCase();
      await q(aux, "select public.conciliacion_subir($1::jsonb)", [JSON.stringify({ banco: "BBVA", cuenta: "0159" + tag, moneda: "MXN", abonos: [{ fecha: "2026-11-19", descripcion: `PEGATRON ${tag}`, monto: 432832.84 }] })]);
      const m = (await q(jefa, "select id from public.conciliacion_movimientos where descripcion=$1", [`PEGATRON ${tag}`])).rows[0].id;
      const comprador = w.buyer1;
      expect(await failure(q(aux, "select public.conciliacion_marcar_previo($1, $2)", [m, ["F1"]]))).toMatch(/Solo la jefa/);
      expect(await failure(q(w.seller1, "select public.conciliacion_marcar_previo($1, $2)", [m, ["F1"]]))).toMatch(/Solo la jefa/);
      const n = (await q(comprador, "select public.conciliacion_marcar_previo($1, $2, 'Recibido en fisico', 'Alejandra Rangel') n", [m, ["f10815", " F10817 ", "F10815"]])).rows[0].n;
      expect(n).toBe(3);
      const mv = (await q("postgres", "select previo, tomado_por is not null t, tomado_para, (select count(*)::int from public.conciliacion_facturas where movimiento_id=$1) f from public.conciliacion_movimientos where id=$1", [m])).rows[0];
      expect(mv).toEqual({ previo: true, t: true, tomado_para: "Alejandra Rangel", f: 2 });
      // Nadie lo toma ni lo suelta (finanzas tampoco)
      expect(await failure(q(w.seller1, "select public.conciliacion_tomar($1, $2)", [m, ["X1"]]))).toMatch(/ya lo tomo|antes del portal/);
      expect(await failure(q(aux, "select public.conciliacion_soltar($1)", [m]))).toMatch(/antes del portal/);
      // Se puede deshacer
      await q(jefa, "select public.conciliacion_quitar_previo($1)", [m]);
      expect((await q("postgres", "select previo, tomado_por from public.conciliacion_movimientos where id=$1", [m])).rows[0]).toEqual({ previo: false, tomado_por: null });
    });
  });
}
