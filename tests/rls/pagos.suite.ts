import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld } from "./fixtures";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

async function user(rol: string): Promise<{ id: string; a: Actor }> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1,$2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, `U ${rol}`, `${id}@esc.test`, rol]);
  return { id, a: { id, role: "authenticated" } };
}

export function pagosSuite() {
  describe.skipIf(!DATABASE_URL)("Pagos a proveedores extranjeros", () => {
    it("comprador registra OC y facturas; el CEO paga en cuanto hay factura; liberado es seguimiento de la carga; urgente avisa", async () => {
      const w = await createWorld();
      const ceo = await user("ceo");
      const sid = (await q(w.buyer1, "insert into public.suppliers (nombre, tipo, pais) values ($1,'extranjero','China') returning id", [`Shenzhen ${randomUUID().slice(0, 6)}`])).rows[0].id;
      // El CEO ve todos los proveedores (lectura, como la gerente) pero no los edita
      expect((await q(ceo.a, "select id from public.suppliers where id=$1", [sid])).rowCount).toBe(1);
      expect((await q(ceo.a, "update public.suppliers set nombre='x' where id=$1", [sid])).rowCount).toBe(0);
      expect(await failure(q(w.buyer1, "insert into public.ordenes_compra (supplier_id, numero) values ($1,'OC-1')", [sid]))).toMatch(/row-level security/);
      await q(w.buyer1, "update public.suppliers set en_pagos=true where id=$1", [sid]);
      expect((await q(ceo.a, "select id from public.suppliers where id=$1", [sid])).rowCount).toBe(1);
      const oc = (await q(w.buyer1, "insert into public.ordenes_compra (supplier_id, numero, moneda, monto) values ($1,'OC-1','USD',10000) returning id", [sid])).rows[0].id;
      expect(await failure(q(ceo.a, "insert into public.pagos (oc_id) values ($1)", [oc]))).toMatch(/row-level security/);
      // Anticipo sin factura todavia, luego se completa
      const p = (await q(w.buyer1, "insert into public.pagos (oc_id, tipo) values ($1,'anticipo') returning id, estado", [oc])).rows[0];
      expect(p.estado).toBe("pendiente");
      expect(await failure(q(w.buyer1, "update public.pagos set estado='pagado' where id=$1", [p.id]))).toMatch(/permission denied/);
      await q(w.buyer1, "update public.pagos set monto=3000, numero_factura='PI-77', fecha_limite=current_date+1 where id=$1", [p.id]);
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='pago_pendiente' and user_id=$1", [ceo.id])).rows[0].count)).toBe(1);
      // Seguimiento: carga sin liberar, comentario y urgente (solo el comprador)
      expect((await q(ceo.a, "update public.pagos set urgente=true where id=$1", [p.id])).rowCount).toBe(0);
      await q(w.buyer1, "update public.pagos set urgente=true, estado_nota='Pendiente de pago para liberacion' where id=$1", [p.id]);
      const urg = (await q("postgres", "select titulo, cuerpo from public.notifications where tipo='pago_urgente' and user_id=$1", [ceo.id])).rows[0];
      expect(urg.titulo).toMatch(/^URGENTE/);
      expect(urg.cuerpo).toBe("Pendiente de pago para liberacion");
      await q(w.buyer1, "update public.pagos set carga='liberada' where id=$1", [p.id]);
      expect((await q(w.buyer1, "select carga_at is not null as c from public.pagos where id=$1", [p.id])).rows[0].c).toBe(true);
      await q(w.buyer1, "update public.pagos set carga='sin_liberar' where id=$1", [p.id]);
      expect((await q("postgres", "select public.pagos_recordatorio() as n")).rows[0].n).toBeGreaterThanOrEqual(1);
      // CEO paga con comprobante
      expect(await failure(q(w.buyer1, "select public.pago_marcar_pagado($1, current_date, 3000)", [p.id]))).toMatch(/CEO/);
      expect(await failure(q(ceo.a, "select public.pago_marcar_pagado($1, current_date, 3000, 'SWIFT 1', null, 'otro/x.pdf', 'x.pdf')", [p.id]))).toMatch(/Archivo invalido/);
      await q(ceo.a, "insert into storage.objects (bucket_id, name) values ('pagos', $1)", [`${p.id}/swift.pdf`]);
      await q(ceo.a, "select public.pago_marcar_pagado($1, current_date, 3000, 'SWIFT 1', null, $2, 'swift.pdf')", [p.id, `${p.id}/swift.pdf`]);
      const paid = (await q(w.buyer1, "select estado, pagado_nombre, comprobante_nombre, urgente from public.pagos where id=$1", [p.id])).rows[0];
      expect(paid).toEqual({ estado: "pagado", pagado_nombre: "U ceo", comprobante_nombre: "swift.pdf", urgente: false });
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='pago_hecho' and user_id=$1", [w.ids.b1])).rows[0].count)).toBe(1);
      expect(await failure(q(w.buyer1, "update public.pagos set monto=1 where id=$1", [p.id]))).toMatch(/ya no se puede/);
      await q(w.buyer1, "update public.pagos set numero_factura='INV-77' where id=$1", [p.id]);
      expect(await failure(q(w.buyer1, "delete from public.pagos where id=$1", [p.id]))).toMatch(/no se han pagado/);
      await q(w.buyer1, "select public.pago_cerrar($1)", [p.id]);
      expect((await q(w.buyer1, "select estado from public.pagos where id=$1", [p.id])).rows[0].estado).toBe("cerrado");
      expect(await failure(q(ceo.a, "select public.pago_deshacer($1)", [p.id]))).toMatch(/aun no archiva/);
      // Nadie mas ve los pagos
      expect((await q(w.seller1, "select id from public.pagos where id=$1", [p.id])).rowCount).toBe(0);
      expect((await q(w.seller1, "select id from public.ordenes_compra where id=$1", [oc])).rowCount).toBe(0);
      // Borrar: un pago sin liberar si; la OC solo sin pagos
      const p2 = (await q(w.buyer1, "insert into public.pagos (oc_id, monto) values ($1, 5) returning id", [oc])).rows[0].id;
      expect((await q(w.buyer1, "delete from public.pagos where id=$1", [p2])).rowCount).toBe(1);
      expect((await q(w.buyer1, "delete from public.ordenes_compra where id=$1", [oc])).rowCount).toBe(0);
      // Deshacer antes de que el comprador archive
      const p3 = (await q(w.buyer1, "insert into public.pagos (oc_id, monto) values ($1, 50) returning id", [oc])).rows[0].id;
      await q(ceo.a, "select public.pago_marcar_pagado($1, current_date, null)", [p3]);
      await q(ceo.a, "select public.pago_deshacer($1)", [p3]);
      expect((await q(w.buyer1, "select estado, pago_monto from public.pagos where id=$1", [p3])).rows[0]).toEqual({ estado: "pendiente", pago_monto: null });
      // Pago parcial (anticipo): el resto queda como saldo por pagar; no se puede pagar de mas
      const p4 = (await q(w.buyer1, "insert into public.pagos (oc_id, monto, numero_factura) values ($1, 1000, 'PI-9') returning id", [oc])).rows[0].id;
      const avisosCeo = Number((await q("postgres", "select count(*) from public.notifications where user_id=$1", [ceo.id])).rows[0].count);
      expect(await failure(q(ceo.a, "select public.pago_marcar_pagado($1, current_date, 1500)", [p4]))).toMatch(/mas que el monto/);
      await q(ceo.a, "select public.pago_marcar_pagado($1, current_date, 300)", [p4]);
      const filas = (await q(w.buyer1, "select estado, monto::float as monto, pago_monto::float as pagado from public.pagos where oc_id=$1 and numero_factura='PI-9' order by estado", [oc])).rows;
      expect(filas).toEqual([{ estado: "pagado", monto: 300, pagado: 300 }, { estado: "pendiente", monto: 700, pagado: null }]);
      expect(Number((await q("postgres", "select count(*) from public.notifications where user_id=$1", [ceo.id])).rows[0].count)).toBe(avisosCeo);
      // Proforma como referencia de la OC
      await q(w.buyer1, "update public.ordenes_compra set proforma_numero='PI-1', proforma_monto=10000, proforma_path=$2 where id=$1", [oc, `${oc}/proforma-x.pdf`]);
      await q(w.buyer1, "insert into storage.objects (bucket_id, name) values ('pagos', $1)", [`${oc}/proforma-x.pdf`]);
      expect(await failure(q(w.seller1, "insert into storage.objects (bucket_id, name) values ('pagos', $1)", [`${oc}/proforma-y.pdf`]))).toBeTruthy();
      // Anticipo de 3000 pagado; la factura de 6000 le descuenta 3000 y el CEO paga solo 3000
      const oc2 = (await q(w.buyer1, "insert into public.ordenes_compra (supplier_id, numero, fecha, moneda) values ($1, 'OC-AP-' || floor(random()*1e6), current_date, 'USD') returning id", [sid])).rows[0].id;
      const ant = (await q(w.buyer1, "insert into public.pagos (oc_id, tipo, monto) values ($1, 'anticipo', 3000) returning id", [oc2])).rows[0].id;
      expect(await failure(q(w.buyer1, "insert into public.pagos (oc_id, tipo, monto, anticipo_aplicado) values ($1, 'factura', 6000, 3000)", [oc2]))).toMatch(/anticipo pagado sin aplicar/);
      await q(ceo.a, "select public.pago_marcar_pagado($1, current_date, null)", [ant]);
      const fac = (await q(w.buyer1, "insert into public.pagos (oc_id, tipo, monto, anticipo_aplicado) values ($1, 'factura', 6000, 3000) returning id", [oc2])).rows[0].id;
      expect(await failure(q(w.buyer1, "insert into public.pagos (oc_id, tipo, monto, anticipo_aplicado) values ($1, 'factura', 500, 100)", [oc2]))).toMatch(/anticipo pagado sin aplicar/);
      expect(await failure(q(ceo.a, "select public.pago_marcar_pagado($1, current_date, 4000)", [fac]))).toMatch(/mas que el monto/);
      await q(ceo.a, "select public.pago_marcar_pagado($1, current_date, null)", [fac]);
      expect((await q(w.buyer1, "select pago_monto::float as p from public.pagos where id=$1", [fac])).rows[0].p).toBe(3000);
    });
  });
}
