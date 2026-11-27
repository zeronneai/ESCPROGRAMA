import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure, type Actor } from "./helpers";

const q = (actor: Actor, sql: string, params: unknown[] = []) => as(actor, (x) => x(sql, params));

async function persona(rol: string, nombre: string): Promise<Actor & { id: string }> {
  const id = randomUUID();
  await q("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@esc.test`]);
  await q("postgres", "insert into public.profiles (id, nombre, correo, rol, must_change_password) values ($1,$2,$3,$4,false)", [id, nombre, `${id}@esc.test`, rol]);
  return { id, role: "authenticated" };
}

const mas = (iso: string, d: number) => new Date(new Date(iso + "T12:00:00Z").getTime() + d * 864e5).toISOString().slice(0, 10);
const J = (o: object) => JSON.stringify(o);

export function rrhhSuite() {
  describe.skipIf(!DATABASE_URL)("RR.HH. vacaciones y permisos", () => {
    it("saldo por ley; filtros por puesto (jefa de ventas, sup. almacen) y la gerente termina; colaboradores sin portal", async () => {
      const ger = await persona("gerente", "Gerente RH");
      const supAlm = await persona("supervisor_almacen", "Sup Almacen");
      const jefa = await persona("jefe_ventas", "Jefa Ventas RH");
      const emp = await persona("almacen", "Empleado Uno");
      const vend = await persona("vendedor", "Vendedor RH");
      const comp = await persona("comprador", "Comprador RH");
      const hoy = (await q("postgres", "select public.local_today()::text as d")).rows[0].d as string;
      const ingreso = (await q("postgres", "select (public.local_today() - interval '3 years 2 months')::date::text as d")).rows[0].d as string;
      const corte = (await q("postgres", "select (public.local_today() - interval '3 months')::date::text as d")).rows[0].d as string;
      const lunes = (await q("postgres", "select (public.local_today() + 30 + ((8 - extract(isodow from public.local_today() + 30)::int) % 7))::text as d")).rows[0].d as string;
      await q("postgres", "delete from public.rrhh_festivos where fecha between $1 and $2", [lunes, mas(lunes, 60)]);

      // La gerente ve a todos los del sistema (cada usuario ya tiene su renglon) y captura
      const todos = (await q(ger, "select * from public.rrhh_saldos()")).rows;
      for (const x of [supAlm, jefa, emp, vend, comp]) expect(todos.find((r) => r.empleado_id === x.id)).toMatchObject({ capturado: false });
      expect(await failure(q(supAlm, "select public.rrhh_empleado_guardar($1::jsonb)", [J({ profile_id: emp.id, fecha_ingreso: ingreso, saldo_inicial: 5, saldo_al: corte })]))).toMatch(/gerente/);
      await q(ger, "select public.rrhh_empleado_guardar($1::jsonb)", [J({ profile_id: emp.id, fecha_ingreso: ingreso, puesto: "Almacenista", saldo_inicial: 5, saldo_al: corte })]);
      await q(ger, "select public.rrhh_empleado_guardar($1::jsonb)", [J({ profile_id: vend.id, fecha_ingreso: ingreso, saldo_inicial: 5, saldo_al: corte })]);
      const s0 = (await q(emp, "select * from public.rrhh_saldos()")).rows;
      expect(s0).toHaveLength(1);
      expect(s0[0]).toMatchObject({ capturado: true, anios: 3, dias_ley: 16, dias_proximo: 18, jefe_rol: "supervisor_almacen" });
      expect(Number(s0[0].disponible)).toBe(21);
      // El sup. de almacen ve a almacen, no a vendedores; la jefa ve a vendedores
      const vsa = (await q(supAlm, "select * from public.rrhh_saldos()")).rows.map((r) => r.empleado_id);
      expect(vsa).toContain(emp.id);
      expect(vsa).not.toContain(vend.id);
      expect((await q(jefa, "select * from public.rrhh_saldos()")).rows.map((r) => r.empleado_id)).toContain(vend.id);

      // Almacen pide: primero el supervisor (visto bueno), despues la gerente
      const id = (await q(emp, "select public.rrhh_solicitar($1::jsonb) as id", [J({ tipo: "vacaciones", desde: lunes, hasta: mas(lunes, 2) })])).rows[0].id as string;
      expect((await q("postgres", "select count(*)::int as n from public.notifications where user_id=$1 and ref_id=$2", [supAlm.id, id])).rows[0].n).toBe(1);
      expect(await failure(q(supAlm, "select public.rrhh_resolver($1, 'aprobar')", [id]))).toMatch(/gerente/);
      expect(await failure(q(jefa, "select public.rrhh_resolver($1, 'visto')", [id]))).toMatch(/permiso/i);
      await q(supAlm, "select public.rrhh_resolver($1, 'visto')", [id]);
      await q(ger, "select public.rrhh_resolver($1, 'aprobar')", [id]);
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(18);

      // Vendedor: la jefa de ventas da el visto bueno; la gerente lo cambia de permiso a vacaciones
      const p = (await q(vend, "select public.rrhh_solicitar($1::jsonb) as id", [J({ tipo: "permiso", permiso_tipo: "ausentarse", desde: mas(lunes, 7), hasta: mas(lunes, 8), motivo: "Asunto personal" })])).rows[0].id as string;
      expect((await q("postgres", "select count(*)::int as n from public.notifications where user_id=$1 and ref_id=$2", [jefa.id, p])).rows[0].n).toBe(1);
      expect((await q(jefa, "select * from public.rrhh_solicitudes_ver()")).rows.find((r) => r.id === p)).toMatchObject({ soy_jefe: true, nombre: "Vendedor RH" });
      await q(jefa, "select public.rrhh_resolver($1, 'visto')", [p]);
      await q(ger, "select public.rrhh_resolver($1, 'aprobar', null, 'vacaciones')", [p]);
      const pv = (await q(vend, "select * from public.rrhh_solicitudes_ver()")).rows[0];
      expect(pv).toMatchObject({ tipo: "vacaciones", estado: "aprobada" });
      expect(Number(pv.dias)).toBe(2);
      expect(pv.cambio).toMatch(/permiso a vacaciones/);
      expect(Number((await q(vend, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(19);

      // Comprador: directo con la gerente
      const pc = (await q(comp, "select public.rrhh_solicitar($1::jsonb) as id", [J({ tipo: "permiso", permiso_tipo: "llegar_tarde", desde: hoy, hora: "10:00", motivo: "Cita medica" })])).rows[0].id as string;
      expect((await q("postgres", "select count(*)::int as n from public.notifications where user_id=$1 and ref_id=$2", [ger.id, pc])).rows[0].n).toBe(1);
      expect((await q(supAlm, "select * from public.rrhh_solicitudes_ver()")).rows.find((r) => r.id === pc)).toBeUndefined();

      // Sin portal: el sup. de almacen lo da de alta y pide por el (ya con su visto bueno)
      expect(await failure(q(jefa, "select public.rrhh_externo_guardar($1::jsonb)", [J({ nombre: "Pedro Cargador" })]))).toMatch(/supervisor/);
      const ext = (await q(supAlm, "select public.rrhh_externo_guardar($1::jsonb) as id", [J({ nombre: "Pedro Cargador", puesto: "Cargador" })])).rows[0].id as string;
      expect(await failure(q(supAlm, "select public.rrhh_solicitar($1::jsonb)", [J({ colaborador_id: ext, tipo: "vacaciones", desde: lunes, hasta: lunes })]))).toMatch(/gerente/);
      await q(ger, "select public.rrhh_empleado_guardar($1::jsonb)", [J({ id: ext, fecha_ingreso: ingreso, saldo_inicial: 4, saldo_al: hoy })]);
      const pe = (await q(supAlm, "select public.rrhh_solicitar($1::jsonb) as id", [J({ colaborador_id: ext, tipo: "vacaciones", desde: mas(lunes, 14), hasta: mas(lunes, 14) })])).rows[0].id as string;
      expect((await q(ger, "select * from public.rrhh_solicitudes_ver()")).rows.find((r) => r.id === pe)).toMatchObject({ estado: "visto_jefe", sin_portal: true, nombre: "Pedro Cargador", registro_nombre: "Sup Almacen" });
      // Nadie mas pide por otros con portal
      expect(await failure(q(supAlm, "select public.rrhh_solicitar($1::jsonb)", [J({ colaborador_id: s0[0].colaborador_id, tipo: "permiso", permiso_tipo: "llegar_tarde", desde: hoy, motivo: "xxx" })]))).toMatch(/sin portal/);
      await q(ger, "select public.rrhh_resolver($1, 'aprobar', null, null, null, 0.5)", [pe]);
      const se = (await q(ger, "select * from public.rrhh_saldos()")).rows.find((r) => r.colaborador_id === ext);
      expect(Number(se.disponible)).toBe(3.5);
      expect(se.sin_portal).toBe(true);

      // Marketplaces es de la jefa; la jefa pide por un vendedor sin portal que la gerente dio de alta en ventas
      const mkt = await persona("marketplaces", "Marketplaces RH");
      const pm = (await q(mkt, "select public.rrhh_solicitar($1::jsonb) as id", [J({ tipo: "permiso", permiso_tipo: "salir_temprano", desde: hoy, motivo: "Tramite" })])).rows[0].id as string;
      expect((await q("postgres", "select count(*)::int as n from public.notifications where user_id=$1 and ref_id=$2", [jefa.id, pm])).rows[0].n).toBe(1);
      const jose = (await q(ger, "select public.rrhh_externo_guardar($1::jsonb) as id", [J({ nombre: "Jose Ortiz", puesto: "Vendedor", jefe_rol: "jefe_ventas" })])).rows[0].id as string;
      expect((await q(supAlm, "select * from public.rrhh_saldos()")).rows.find((r) => r.colaborador_id === jose)).toBeUndefined();
      expect((await q(jefa, "select * from public.rrhh_saldos()")).rows.find((r) => r.colaborador_id === jose)).toBeTruthy();
      const pj = (await q(jefa, "select public.rrhh_solicitar($1::jsonb) as id", [J({ colaborador_id: jose, tipo: "permiso", permiso_tipo: "ausentarse", desde: hoy, motivo: "Cita medica" })])).rows[0].id as string;
      expect((await q(ger, "select estado from public.rrhh_solicitudes where id=$1", [pj])).rows[0].estado).toBe("visto_jefe");
      expect(await failure(q(supAlm, "select public.rrhh_solicitar($1::jsonb)", [J({ colaborador_id: jose, tipo: "permiso", permiso_tipo: "ausentarse", desde: hoy, motivo: "xxx" })]))).toMatch(/sin portal/);
      const cm = (await q(mkt, "insert into public.consumo_solicitudes (tipo, categoria, descripcion, cantidad, motivo) values ('producto','papeleria','Etiquetas',1,'Envios') returning aprobador_rol")).rows[0];
      expect(cm.aprobador_rol).toBe("jefe_ventas");

      // Calendario: los demas ven solo el puesto
      const cal = (await q(comp, "select * from public.rrhh_calendario($1, $2)", [lunes, mas(lunes, 2)])).rows.filter((r) => r.clase === "vacaciones");
      expect(cal[0]).toMatchObject({ puesto: "Almacenista", nombre: null });

      // Temporada general: dias a descontar a todos
      const t1 = mas(lunes, 21);
      await q(ger, "insert into public.rrhh_temporadas (nombre, desde, hasta, dias_descuento) values ('Semana Santa', $1, $2, $3)", [t1, mas(t1, 4), [t1, mas(t1, 1)]]);
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(16);
      expect(await failure(q(emp, "insert into public.rrhh_temporadas (nombre, desde, hasta) values ('X', $1, $2)", [t1, t1]))).toMatch(/row-level/);

      // Cancelar regresa los dias; solo la gerente cambia reglas
      await q(emp, "select public.rrhh_cancelar($1)", [id]);
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(19);
      expect((await q(emp, "update public.rrhh_config set sabado_laborable=false where id=1")).rowCount).toBe(0);
    });
  });
}
