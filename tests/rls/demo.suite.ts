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
        (select count(*) from public.customers where nombre like '%(Demo)' and convertido_at is not null)::int as convertidos,
        (select count(*) from public.consumo_solicitudes where estado='completada')::int >= 1 as consumo,
        (select count(*) from public.guias where estado='requiere_datos')::int >= 1 as guias`)).rows[0];
      expect(counts).toMatchObject({ clientes: 9, solicitudes: 4, enviadas: 3, bitacora: 10, articulos: true, convertidos: 1, consumo: true, guias: true });
      expect((await q(w.buyer1, "select public.demo_cargar('guias') as r")).rows[0].r).toMatch(/ya estaba cargada/);
      // La sesion del comprador queda como estaba.
      expect((await q(w.buyer1, "select public.demo_cargar('clientes') as r, auth.uid() as u")).rows[0].u).toBe(w.ids.b1);
    });
  });
}
