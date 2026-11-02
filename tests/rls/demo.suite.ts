import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure } from "./helpers";
import { createWorld } from "./fixtures";

const q = (actor: Parameters<typeof as>[0], sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

export function demoSuite() {
  describe.skipIf(!DATABASE_URL)("Datos de demostracion y catalogo de articulos", () => {
    it("catalogo: 987 articulos, solo los vendibles se ligan a la bitacora", async () => {
      const w = await createWorld();
      const r = (await q(w.seller1, "select count(*)::int as total, count(*) filter (where vendible)::int as vendibles from public.articulos")).rows[0];
      expect(r).toEqual({ total: 987, vendibles: 700 });
      const c = (await q(w.seller1, "insert into public.customers (nombre, tipo, giro, estado_geo, created_by) values ('Art '||gen_random_uuid(),'prospecto','X','Chihuahua',$1) returning id", [w.ids.s1])).rows[0].id;
      const b = (await q(w.seller1, "insert into public.bitacora (vendedor_id, customer_id, created_by) values ($1,$2,$1) returning id", [w.ids.s1, c])).rows[0].id;
      const ok = (await q(w.seller1, "select id from public.articulos where vendible limit 1")).rows[0].id;
      const baja = (await q(w.seller1, "select id from public.articulos where estatus='baja' limit 1")).rows[0].id;
      await q(w.seller1, "insert into public.bitacora_articulos (bitacora_id, articulo_id, cantidad) values ($1,$2,5)", [b, ok]);
      expect(await failure(q(w.seller1, "insert into public.bitacora_articulos (bitacora_id, articulo_id) values ($1,$2)", [b, baja]))).toMatch(/suspendido o dado de baja/);
      expect(await failure(q(w.seller2, "insert into public.bitacora_articulos (bitacora_id, articulo_id) values ($1,$2)", [b, ok]))).toMatch(/row-level security/);
      expect((await q(w.seller1, "delete from public.bitacora_articulos where bitacora_id=$1", [b])).rowCount).toBe(1);
      expect((await q(w.seller1, "update public.articulos set nombre='x' where id=$1", [ok])).rowCount).toBe(0);
    });

    it("el comprador carga la demostracion completa con los usuarios reales; nadie mas puede", async () => {
      const w = await createWorld();
      for (const rol of ["coordinador_iso", "jefe_ventas", "marketplaces"]) {
        const id = (await q("postgres", "select gen_random_uuid() as id")).rows[0].id;
        await q("postgres", "insert into auth.users (id, email) values ($1,$2)", [id, `${id}@esc.test`]);
        await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, `Demo ${rol}`, `${id}@esc.test`, rol]);
      }
      expect(await failure(q(w.seller1, "select public.demo_cargar('todo')"))).toMatch(/comprador/);
      const out = (await q(w.buyer1, "select public.demo_cargar('todo') as r")).rows[0].r as string;
      expect(out).toMatch(/clientes: 8 clientes/);
      expect(out).toMatch(/cotizaciones: 4 solicitudes/);
      expect(out).toMatch(/calidad: 3 quejas y 1 accion correctiva/);
      expect(out).toMatch(/guias: 4 guias \(1 generandose/);
      const counts = (await q("postgres", `select
        (select count(*) from public.customers where nombre like '%(Demo)')::int as clientes,
        (select count(*) from public.quote_requests r join public.customers c on c.id=r.customer_id where c.nombre like '%(Demo)' and r.estado='enviada')::int as solicitudes,
        (select count(*) from public.quote_items i join public.quote_requests r on r.id=i.request_id join public.customers c on c.id=r.customer_id where c.nombre like '%(Demo)' and exists (select 1 from public.item_dispatch d where d.item_id=i.id))::int as enviadas,
        (select count(*) from public.bitacora b join public.customers c on c.id=b.customer_id where c.nombre like '%(Demo)')::int as bitacora,
        (select count(*) from public.bitacora_articulos)::int > 0 as articulos,
        (select count(*) from public.ventas v join public.customers c on c.id=v.customer_id where c.nombre like '%(Demo)')::int as ventas,
        (select count(*) from public.ventas v join public.customers c on c.id=v.customer_id where c.nombre like '%(Demo)' and v.origen='portal')::int as ventas_portal,
        (select count(*) from public.customers where nombre like '%(Demo)' and convertido_at is not null)::int as convertidos,
        (select count(*) from public.consumo_solicitudes where estado='completada')::int >= 1 as consumo,
        (select count(*) from public.guias where estado='requiere_datos')::int >= 1 as guias`)).rows[0];
      expect(counts).toMatchObject({ clientes: 9, solicitudes: 4, enviadas: 3, bitacora: 5, ventas: 8, ventas_portal: 1, articulos: true, convertidos: 1, consumo: true, guias: true });
      expect((await q(w.buyer1, "select public.demo_cargar('guias') as r")).rows[0].r).toMatch(/ya estaba cargada/);
      // La sesion del comprador queda como estaba.
      expect((await q(w.buyer1, "select public.demo_cargar('clientes') as r, auth.uid() as u")).rows[0].u).toBe(w.ids.b1);
    });
  });
}

export function ventasSuite() {
  describe.skipIf(!DATABASE_URL)("Ventas diarias", () => {
    it("el vendedor registra su venta; un prospecto que compra pasa a cliente y su prospeccion se cierra", async () => {
      const w = await createWorld();
      const c = (await q(w.seller1, "insert into public.customers (nombre, tipo, giro, estado_geo, created_by) values ('V '||gen_random_uuid(),'prospecto','X','Chihuahua',$1) returning id", [w.ids.s1])).rows[0].id;
      const b = (await q(w.seller1, "insert into public.bitacora (vendedor_id, customer_id, created_by) values ($1,$2,$1) returning id", [w.ids.s1, c])).rows[0].id;
      const v = (await q(w.seller1, "insert into public.ventas (customer_id, monto, pago, factura) values ($1, 1000, 'credito', 'A-1') returning id, vendedor_id, dias_credito, vence - fecha as plazo", [c])).rows[0];
      expect(v).toMatchObject({ vendedor_id: w.ids.s1, dias_credito: 30, plazo: 30 });
      expect((await q(w.seller1, "select tipo, convertido_por from public.customers where id=$1", [c])).rows[0]).toEqual({ tipo: "cliente", convertido_por: w.ids.s1 });
      expect((await q(w.seller1, "select resultado from public.bitacora where id=$1", [b])).rows[0].resultado).toBe("ganada");
      const art = (await q(w.seller1, "select id, nombre from public.articulos where vendible limit 1")).rows[0];
      await q(w.seller1, "insert into public.venta_lineas (venta_id, articulo_id, descripcion, cantidad) values ($1,$2,$3,5)", [v.id, art.id, art.nombre]);
      expect((await q(w.seller2, "select id from public.ventas where id=$1", [v.id])).rowCount).toBe(0);
      expect(await failure(q(w.seller2, "insert into public.venta_lineas (venta_id, descripcion) values ($1,'x')", [v.id]))).toMatch(/row-level security/);
      expect((await q(w.buyer1, "select id from public.ventas where id=$1", [v.id])).rowCount).toBe(1);
      await q(w.seller1, "update public.ventas set entregado=true, porcentaje_cobrado=100 where id=$1", [v.id]);
      expect((await q(w.seller1, "select fecha_entrega is not null as e, fecha_cobro is not null as c from public.ventas where id=$1", [v.id])).rows[0]).toEqual({ e: true, c: true });
      await q(w.seller1, "update public.ventas set cancelada_at=now() where id=$1", [v.id]);
      expect((await q(w.seller1, "update public.ventas set monto=5 where id=$1", [v.id])).rowCount).toBe(0);
      expect(await failure(q("postgres", "delete from public.ventas where id=$1", [v.id]))).toMatch(/inmutable/);
    });

    it("solicitudes de clientes ya no abren prospeccion; la de un prospecto si", async () => {
      const w = await createWorld();
      await q(w.buyer1, "update public.customers set tipo='cliente' where id=$1", [w.customerId]);
      const r = (await q(w.seller1, "insert into public.quote_requests (id, vendedor_id, customer_id) values (gen_random_uuid(), $1, $2) returning id", [w.ids.s1, w.customerId])).rows[0].id;
      await q(w.seller1, "insert into public.quote_items (request_id, producto, descripcion, cantidad, unidad) values ($1,'Prod','Descripcion suficiente',4,'pieza') returning id", [r]).then((x) => q(w.seller1, "insert into public.item_references (item_id,tipo,url) values ($1,'link','https://a.com')", [x.rows[0].id]));
      await q(w.seller1, "update public.quote_requests set estado='enviada', due_at=now()+interval '3 days' where id=$1", [r]);
      expect((await q(w.seller1, "select id from public.bitacora where request_id=$1", [r])).rowCount).toBe(0);
    });
  });
}
