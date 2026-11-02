import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld, type World } from "./fixtures";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));
let w: World;
let alm: Actor;
let almId: string;
const anon: Actor = { id: "", role: "anon" };

const preguntas = async (resp: string) =>
  Object.fromEntries((await q("postgres", "select id from public.eval_preguntas where responsable=$1 and activo order by orden", [resp])).rows.map((r, i) => [r.id, (i % 5) + 1]));

export function evaluacionesSuite() {
  describe.skipIf(!DATABASE_URL)("Evaluacion de proveedores y de clientes", () => {
    beforeAll(async () => {
      w = await createWorld();
      almId = randomUUID();
      await q("postgres", "insert into auth.users (id, email) values ($1,$2)", [almId, `${almId}@esc.test`]);
      await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,'Almacen',$2,'almacen',false)", [almId, `${almId}@esc.test`]);
      alm = { id: almId, role: "authenticated" };
    });

    it("proveedores: el comprador da de alta, activa; almacen solo ve y califica cuando esta activa; se programa la siguiente a 6 meses", async () => {
      const sid = (await q(w.buyer1, "insert into public.suppliers (nombre, rfc, contacto_nombre, telefono, correo, evaluar) values ($1,'abc-010101 ab1','Juan','6561234567','VENTAS@PROV.COM',true) returning id, rfc, correo, created_by", [`Prov ${randomUUID().slice(0, 6)}`])).rows[0];
      expect(sid).toMatchObject({ rfc: "ABC010101AB1", correo: "ventas@prov.com", created_by: w.ids.b1 });
      expect(await failure(q(w.seller1, "insert into public.suppliers (nombre) values ('X')"))).toMatch(/row-level security/);
      expect((await q(alm, "select id from public.suppliers where id=$1", [sid.id])).rowCount).toBe(1);
      expect(await failure(q(alm, "select public.eval_activar('proveedores')"))).toMatch(/No autorizado/);
      await q(w.buyer1, "select public.eval_activar('proveedores')");
      const per = (await q("postgres", "select estado, programado_para - current_date as dias from public.eval_periodos where tipo='proveedores' order by created_at")).rows;
      expect(per.map((p) => p.estado)).toEqual(["activo", "programado"]);
      expect(Number(per[1].dias)).toBeGreaterThan(170);
      expect(Number((await q("postgres", "select count(*) from public.notifications where user_id=$1 and tipo='evaluacion_activa'", [almId])).rows[0].count)).toBe(1);
      const ev = (await q(alm, "select id from public.eval_proveedor where supplier_id=$1", [sid.id])).rows[0].id;
      // Cada quien su parte
      await q(alm, "select public.eval_proveedor_guardar($1,$2::jsonb,'Llego golpeado un bulto')", [ev, JSON.stringify(await preguntas("almacen"))]);
      expect(await failure(q(alm, "select public.eval_proveedor_guardar($1,$2::jsonb)", [ev, JSON.stringify(await preguntas("comprador"))]))).toMatch(/Pregunta invalida/);
      const half = Object.fromEntries(Object.entries(await preguntas("comprador")).slice(0, 2));
      expect(await failure(q(w.buyer1, "select public.eval_proveedor_guardar($1,$2::jsonb)", [ev, JSON.stringify(half)]))).toMatch(/todos los puntos/);
      await q(w.buyer1, "select public.eval_proveedor_guardar($1,$2::jsonb)", [ev, JSON.stringify(await preguntas("comprador"))]);
      const r = (await q(w.buyer1, "select puntaje, comprador_at is not null as c, almacen_at is not null as a from public.eval_proveedor where id=$1", [ev])).rows[0];
      expect(r).toMatchObject({ c: true, a: true, puntaje: "60.0" });
      expect(await failure(q(w.seller1, "select public.eval_proveedor_guardar($1,'{}'::jsonb)", [ev]))).toMatch(/No autorizado/);
      // Activacion automatica cuando llega la fecha
      await q("postgres", "update public.eval_periodos set programado_para = current_date where tipo='proveedores' and estado='programado'");
      expect((await q("postgres", "select public.eval_activar_programados() as n")).rows[0].n).toBe(1);
      expect((await q("postgres", "select estado from public.eval_periodos where tipo='proveedores' order by created_at")).rows.map((p) => p.estado)).toEqual(["cerrado", "activo", "programado"]);
      expect(await failure(q(w.buyer1, "select public.eval_proveedor_guardar($1,$2::jsonb)", [ev, JSON.stringify(await preguntas("comprador"))]))).toMatch(/cerrado/);
    });

    it("clientes: el vendedor genera un link unico, lo marca enviado y el cliente responde sin sesion", async () => {
      // seller1 ve al cliente porque tiene una venta con el
      await q(w.seller1, "insert into public.ventas (customer_id, monto) values ($1, 10)", [w.customerId]);
      expect(await failure(q(w.seller1, "select * from public.encuesta_generar($1)", [w.customerId]))).toMatch(/no esta activa/);
      await q(w.buyer1, "select public.eval_activar('clientes')");
      expect(await failure(q(w.seller2, "select * from public.encuesta_generar($1)", [w.customerId]))).toMatch(/No autorizado/);
      const e = (await q(w.seller1, "select id, token from public.encuesta_generar($1)", [w.customerId])).rows[0];
      expect(e.token).toHaveLength(40);
      const again = (await q(w.seller1, "select id from public.encuesta_generar($1)", [w.customerId])).rows[0];
      expect(again.id).toBe(e.id);
      await q(w.seller1, "select public.encuesta_marcar_enviada($1,'whatsapp')", [e.id]);
      expect(await failure(q(w.seller2, "select public.encuesta_marcar_enviada($1,'correo')", [e.id]))).toMatch(/No autorizado/);
      const pub = (await q(anon, "select public.encuesta_publica($1) as j", [e.token])).rows[0].j;
      expect(pub.preguntas).toHaveLength(5);
      expect(pub.respondida).toBe(false);
      expect((await q(anon, "select public.encuesta_publica('x') as j")).rows[0].j).toBeNull();
      const resp = Object.fromEntries(pub.preguntas.map((p: { id: string }, i: number) => [p.id, i < 3 ? 3 : 2]));
      expect(await failure(q(anon, "select public.encuesta_responder($1,$2::jsonb)", [e.token, JSON.stringify({ ...resp, [pub.preguntas[0].id]: 4 })]))).toMatch(/invalida/);
      await q(anon, "select public.encuesta_responder($1,$2::jsonb,'Muy buen servicio','Laura')", [e.token, JSON.stringify(resp)]);
      expect(await failure(q(anon, "select public.encuesta_responder($1,$2::jsonb)", [e.token, JSON.stringify(resp)]))).toMatch(/ya fue respondida/);
      const row = (await q(w.seller1, "select puntaje, contesto_nombre, respondida_at is not null as r from public.encuestas_cliente where id=$1", [e.id])).rows[0];
      expect(row).toMatchObject({ r: true, contesto_nombre: "Laura", puntaje: "80.0" });
      expect((await q(w.seller2, "select id from public.encuestas_cliente where id=$1", [e.id])).rowCount).toBe(0);
      expect(Number((await q("postgres", "select count(*) from public.notifications where user_id=$1 and tipo='encuesta_respondida'", [w.ids.s1])).rows[0].count)).toBe(1);
      expect(await failure(q(anon, "select id from public.encuestas_cliente"))).toMatch(/permission denied/);
    });
  });
}
