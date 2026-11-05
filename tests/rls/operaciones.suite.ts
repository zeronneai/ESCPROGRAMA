import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";
import { createWorld, type World } from "./fixtures";

let w: World;
const people: Record<string, { id: string; actor: Actor }> = {};
const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));
const A = (k: string) => people[k].actor;

async function person(key: string, rol: string) {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, `${key} ${id.slice(0, 4)}`, `${id}@esc.test`, rol]);
  people[key] = { id, actor: { id, role: "authenticated" } };
}
const notif = async (userId: string, tipo: string, ref: string) =>
  Number((await q("postgres", "select count(*) from public.notifications where user_id=$1 and tipo=$2 and ref_id=$3", [userId, tipo, ref])).rows[0].count);

const GUIA = "insert into public.guias (factura, destinatario, paqueteria, telefono, calle_numero, cp, ciudad, estado_geo, peso_kg) values ($1,'Foxconn','DHL','6561234567','Av. Uno 100','32000','Juarez','Chihuahua',3.5) returning id, numero, vendedor_id, estado";

export function operacionesSuite() {
  describe.skipIf(!DATABASE_URL)("Quejas, acciones correctivas, consumo interno y guias", () => {
    beforeAll(async () => {
      w = await createWorld();
      await person("iso", "coordinador_iso");
      await person("gerente", "gerente");
      await person("jefa", "jefe_ventas");
      await person("mkt", "marketplaces");
    });

    it("quejas: el vendedor y el ISO capturan; solo el ISO cambia estatus; otros vendedores no la ven", async () => {
      const r = await q(w.seller1, "insert into public.quejas (via_recepcion, cliente_nombre, descripcion) values ('telefono','Foxconn','Producto llego dañado') returning id, numero, vendedor_id, estado, responsable_nombre");
      const qid = r.rows[0].id;
      expect(r.rows[0]).toMatchObject({ vendedor_id: w.ids.s1, estado: "abierta" });
      expect(r.rows[0].numero).toMatch(/^QC-\d{4}-\d{4}$/);
      expect(await notif(people.iso.id, "queja_nueva", qid)).toBe(1);
      expect((await q(w.seller2, "select id from public.quejas where id=$1", [qid])).rowCount).toBe(0);
      for (const k of ["iso", "gerente", "jefa"]) expect((await q(A(k), "select id from public.quejas where id=$1", [qid])).rowCount).toBe(1);
      expect(await failure(q(w.seller1, "update public.quejas set estado='cerrada' where id=$1", [qid]))).toMatch(/coordinador ISO/);
      expect((await q(A("gerente"), "update public.quejas set descripcion='xxxxxx' where id=$1", [qid])).rowCount).toBe(0);
      await q(A("iso"), "update public.quejas set estado='en_analisis' where id=$1", [qid]);
      expect(await notif(w.ids.s1, "queja_estado", qid)).toBe(1);
      // Ya no esta abierta: el vendedor no la edita, pero si comenta.
      expect((await q(w.seller1, "update public.quejas set descripcion='otra cosa' where id=$1", [qid])).rowCount).toBe(0);
      await q(w.seller1, "insert into public.calidad_eventos (queja_id, tipo, nota) values ($1,'comentario','El cliente manda fotos')", [qid]);
      expect(await failure(q(A("gerente"), "insert into public.calidad_eventos (queja_id, tipo, nota) values ($1,'comentario','x')", [qid]))).toMatch(/row-level security/);
      const ev = await q(w.seller1, "select tipo, autor_nombre from public.calidad_eventos where queja_id=$1 order by created_at", [qid]);
      expect(ev.rows.map((e) => e.tipo)).toEqual(["alta", "estado", "comentario"]);
      expect(ev.rows[2].autor_nombre).toMatch(/Vend A/);
      expect(await failure(q(A("mkt"), "insert into public.quejas (via_recepcion, cliente_nombre, descripcion) values ('telefono','X','Algo paso')"))).toMatch(/row-level security/);
    });

    it("acciones correctivas: solo el ISO crea; el vendedor de la queja la ve y le llega aviso", async () => {
      const qid = (await q(w.seller1, "insert into public.quejas (via_recepcion, cliente_nombre, descripcion) values ('correo','Lear','Cantidad incompleta') returning id")).rows[0].id;
      expect(await failure(q(w.seller1, "insert into public.acciones_correctivas (solicitante, fuente, descripcion) values ('Vend','queja_cliente','Faltante')"))).toMatch(/row-level security/);
      const sac = (await q(A("iso"), "insert into public.acciones_correctivas (solicitante, fuente, queja_id, descripcion) values ('Coord ISO','queja_cliente',$1,'Faltante en embarque') returning id, numero", [qid])).rows[0];
      expect(sac.numero).toMatch(/^SAC-\d{2,}$/);
      expect((await q(w.seller1, "select estado from public.quejas where id=$1", [qid])).rows[0].estado).toBe("con_sac");
      expect(await notif(w.ids.s1, "sac_nueva", sac.id)).toBe(1);
      expect((await q(w.seller1, "select id from public.acciones_correctivas where id=$1", [sac.id])).rowCount).toBe(1);
      expect((await q(w.seller2, "select id from public.acciones_correctivas where id=$1", [sac.id])).rowCount).toBe(0);
      expect((await q(w.seller1, "update public.acciones_correctivas set causa_raiz='x' where id=$1", [sac.id])).rowCount).toBe(0);
      await q(A("iso"), "update public.acciones_correctivas set estado='cerrada', cumple_objetivo=true where id=$1", [sac.id]);
      expect((await q(w.seller1, "select fecha_cierre is not null as c from public.acciones_correctivas where id=$1", [sac.id])).rows[0].c).toBe(true);
      expect(await failure(q("postgres", "delete from public.acciones_correctivas where id=$1", [sac.id]))).toMatch(/inmutable/);
    });

    it("consumo interno: la jefa aprueba y solo entonces el comprador lo ve y marca avance", async () => {
      const c = (await q(w.seller1, "insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, unidad, motivo) values ('producto','papeleria','Hojas carta',2,'paquete','Se acabaron') returning id, estado, numero")).rows[0];
      expect(c).toMatchObject({ estado: "por_aprobar" });
      expect(await notif(people.jefa.id, "consumo_por_aprobar", c.id)).toBe(1);
      expect((await q(w.buyer1, "select id from public.consumo_solicitudes where id=$1", [c.id])).rowCount).toBe(0);
      await q(w.seller1, "update public.consumo_solicitudes set cantidad=3 where id=$1", [c.id]);
      expect(await failure(q(w.seller1, "select public.consumo_aprobar($1,true)", [c.id]))).toMatch(/jefa/);
      expect(await failure(q(w.buyer1, "select public.consumo_avance($1,'en_proceso')", [c.id]))).toMatch(/no esta aprobada/);
      expect(await failure(q(w.seller1, "update public.consumo_solicitudes set estado='aprobada' where id=$1", [c.id]))).toMatch(/permission denied|botones/);
      await q(A("jefa"), "select public.consumo_aprobar($1,true,'Ok')", [c.id]);
      expect((await q(w.buyer1, "select estado from public.consumo_solicitudes where id=$1", [c.id])).rows[0].estado).toBe("aprobada");
      expect(await notif(w.ids.b1, "consumo_aprobado", c.id)).toBe(1);
      expect((await q(w.seller1, "update public.consumo_solicitudes set cantidad=9 where id=$1", [c.id])).rowCount).toBe(0);
      await q(w.buyer1, "select public.consumo_avance($1,'en_proceso','2026-11-05','Pedido a Office Depot')", [c.id]);
      await q(w.buyer1, "select public.consumo_avance($1,'completada')", [c.id]);
      const ev = await q(w.seller1, "select tipo from public.consumo_eventos where solicitud_id=$1 order by created_at", [c.id]);
      expect(ev.rows.map((e) => e.tipo)).toEqual(["alta", "aprobada", "en_proceso", "completada"]);
      expect(await notif(w.ids.s1, "consumo_completada", c.id)).toBe(1);
      // Rechazada: el comprador nunca la ve; la de la jefa se aprueba sola.
      const r = (await q(w.seller1, "insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, motivo) values ('servicio','vehiculo','Afinacion Nissan',1,'Ya toca servicio') returning id")).rows[0].id;
      expect(await failure(q(A("jefa"), "select public.consumo_aprobar($1,false)", [r]))).toMatch(/motivo/);
      await q(A("jefa"), "select public.consumo_aprobar($1,false,'El mes que entra')", [r]);
      expect((await q(w.buyer1, "select id from public.consumo_solicitudes where id=$1", [r])).rowCount).toBe(0);
      const own = (await q(A("jefa"), "insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, motivo) values ('producto','limpieza','Cloro',3,'Limpieza oficina') returning estado")).rows[0];
      expect(own.estado).toBe("aprobada");
      expect(await failure(q(w.buyer1, "insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, motivo) values ('producto','limpieza','Cloro',3,'Limpieza')"))).toMatch(/row-level security/);
    });

    it("guias: el vendedor pide, Marketplaces toma, pide datos y sube la guia; recordatorio a partir de 1 hora", async () => {
      const g = (await q(w.seller1, GUIA, ["F-1234"])).rows[0];
      expect(g).toMatchObject({ vendedor_id: w.ids.s1, estado: "solicitada" });
      expect(await notif(people.mkt.id, "guia_nueva", g.id)).toBe(1);
      expect((await q(w.seller2, "select id from public.guias where id=$1", [g.id])).rowCount).toBe(0);
      expect((await q(A("mkt"), "select id from public.guias where id=$1", [g.id])).rowCount).toBe(1);
      expect((await q(A("mkt"), "select id from public.quejas")).rowCount).toBe(0);
      expect(await failure(q(w.seller1, "select public.guia_mover($1,'en_proceso')", [g.id]))).toMatch(/Marketplaces/);
      expect(await failure(q(w.seller1, "select public.guia_recordar($1)", [g.id]))).toMatch(/1 hora/);
      await q(A("mkt"), "select public.guia_mover($1,'en_proceso')", [g.id]);
      await q(A("mkt"), "select public.guia_mover($1,'requiere_datos','Falta la colonia')", [g.id]);
      expect(await notif(w.ids.s1, "guia_requiere_datos", g.id)).toBe(1);
      await q(w.seller1, "update public.guias set colonia='Centro' where id=$1", [g.id]);
      expect((await q(w.seller1, "select estado from public.guias where id=$1", [g.id])).rows[0].estado).toBe("solicitada");
      expect(await notif(people.mkt.id, "guia_reenviada", g.id)).toBe(1);
      expect(await failure(q(A("mkt"), "select public.guia_mover($1,'lista','', '123', 'otra/guia.pdf')", [g.id]))).toMatch(/Sube el archivo/);
      await q(A("mkt"), "select public.guia_mover($1,'lista',null,'7788990011',$2,'guia.pdf')", [g.id, `${g.id}/guia.pdf`]);
      const done = (await q(w.seller1, "select estado, numero_rastreo, archivo_path from public.guias where id=$1", [g.id])).rows[0];
      expect(done).toMatchObject({ estado: "lista", numero_rastreo: "7788990011" });
      expect(await notif(w.ids.s1, "guia_lista", g.id)).toBe(1);
      expect((await q(w.seller1, "update public.guias set factura='X' where id=$1", [g.id])).rowCount).toBe(0);
      // Recordatorio: a partir de 4 horas, uno por hora.
      const g2 = (await q(w.seller1, GUIA, ["F-9"])).rows[0];
      await q("postgres", "update public.guias set solicitada_at = now() - interval '5 hours' where id=$1", [g2.id]);
      await q(w.seller1, "select public.guia_recordar($1)", [g2.id]);
      expect(await failure(q(w.seller1, "select public.guia_recordar($1)", [g2.id]))).toMatch(/menos de una hora/);
      expect(Number((await q("postgres", "select count(*) from public.notifications where user_id=$1 and tipo='guia_recordatorio' and ref_id=$2", [people.mkt.id, g2.id])).rows[0].count)).toBe(1);
      await q(w.seller1, "insert into public.guia_eventos (guia_id, tipo, nota) values ($1,'comentario','Es urgente, sale hoy')", [g2.id]);
      expect(await failure(q(w.seller2, "insert into public.guia_eventos (guia_id, tipo, nota) values ($1,'comentario','x')", [g2.id]))).toMatch(/row-level security/);
      expect(await failure(q(A("mkt"), "insert into public.guias (factura, destinatario, paqueteria, telefono, calle_numero, cp, ciudad, estado_geo, peso_kg) values ('F','X','DHL','6561234567','Av. Uno 100','32000','Juarez','Chihuahua',1)"))).toMatch(/row-level security/);
    });

    it("gerente e ISO leen ventas y bitacora de todos, sin escribir", async () => {
      const c = (await q(w.seller1, "insert into public.customers (nombre, tipo, giro, estado_geo, created_by) values ($1,'prospecto','X','Chihuahua',$2) returning id", [`Op ${randomUUID().slice(0, 6)}`, w.ids.s1])).rows[0].id;
      const b = (await q(w.seller1, "insert into public.bitacora (vendedor_id, customer_id, created_by) values ($1,$2,$1) returning id", [w.ids.s1, c])).rows[0].id;
      for (const k of ["gerente", "iso"]) {
        expect((await q(A(k), "select id from public.bitacora where id=$1", [b])).rowCount).toBe(1);
        expect((await q(A(k), "select id from public.customers where id=$1", [c])).rowCount).toBe(1);
        expect((await q(A(k), "update public.bitacora set necesidad='x' where id=$1", [b])).rowCount).toBe(0);
        expect((await q(A(k), "update public.customers set giro='x' where id=$1", [c])).rowCount).toBe(0);
      }
      expect((await q(A("mkt"), "select id from public.bitacora where id=$1", [b])).rowCount).toBe(0);
      expect((await q(A("mkt"), "select id from public.customers where id=$1", [c])).rowCount).toBe(0);
    });
  });
}
