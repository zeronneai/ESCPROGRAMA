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

const fecha = (d: Date) => d.toISOString().slice(0, 10);

export function rrhhSuite() {
  describe.skipIf(!DATABASE_URL)("RR.HH. vacaciones y permisos", () => {
    it("la gerente captura el arranque; el saldo suma aniversarios y resta vacaciones; jefe da visto bueno y la gerente autoriza", async () => {
      const ger = await persona("gerente", "Gerente RH");
      const jefe = await persona("supervisor_almacen", "Jefe Almacen");
      const emp = await persona("almacen", "Empleado Uno");
      const otro = await persona("vendedor", "Vendedor Otro");
      const hoy = (await q("postgres", "select public.local_today()::text as d")).rows[0].d as string;
      // Ingreso hace 3 anios y 2 meses; arranque: le quedan 5 dias hace 2 meses (antes de su 3er aniversario).
      const ingreso = (await q("postgres", "select (public.local_today() - interval '3 years 2 months')::date::text as d")).rows[0].d as string;
      const corte = (await q("postgres", "select (public.local_today() - interval '3 months')::date::text as d")).rows[0].d as string;

      // Solo la gerente captura colaboradores
      expect(await failure(q(emp, "insert into public.rrhh_empleados (profile_id, fecha_ingreso) values ($1, $2)", [emp.id, ingreso]))).toMatch(/row-level/);
      await q(ger, "insert into public.rrhh_empleados (profile_id, fecha_ingreso, puesto, jefe_id, saldo_inicial, saldo_al) values ($1,$2,'Almacenista',$3,5,$4)", [emp.id, ingreso, jefe.id, corte]);

      const s0 = (await q(emp, "select * from public.rrhh_saldos()")).rows;
      expect(s0).toHaveLength(1);
      // 3er aniversario cae despues del corte: suma 16 dias.
      expect(s0[0]).toMatchObject({ capturado: true, anios: 3, dias_ley: 16, dias_proximo: 18 });
      expect(Number(s0[0].ganados)).toBe(16);
      expect(Number(s0[0].disponible)).toBe(21);

      // El otro vendedor no ve el saldo del empleado; el jefe si
      expect((await q(otro, "select * from public.rrhh_saldos()")).rows.map((r) => r.empleado_id)).toEqual([otro.id]);
      expect((await q(jefe, "select * from public.rrhh_saldos()")).rows.map((r) => r.empleado_id)).toContain(emp.id);

      // Pide vacaciones dentro de 30 dias (3 dias habiles, lunes a miercoles)
      const lunes = (await q("postgres", "select (public.local_today() + 30 + ((8 - extract(isodow from public.local_today() + 30)::int) % 7))::text as d")).rows[0].d as string;
      const miercoles = fecha(new Date(new Date(lunes + "T12:00:00Z").getTime() + 2 * 864e5));
      await q("postgres", "delete from public.rrhh_festivos where fecha between $1 and $2", [lunes, miercoles]);
      const id = (await q(emp, "select public.rrhh_solicitar($1::jsonb) as id", [JSON.stringify({ tipo: "vacaciones", desde: lunes, hasta: miercoles })])).rows[0].id as string;
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(18);
      // No se puede pedir de mas
      expect(await failure(q(emp, "select public.rrhh_solicitar($1::jsonb)", [JSON.stringify({ tipo: "vacaciones", desde: fecha(new Date(new Date(lunes + "T12:00:00Z").getTime() + 7 * 864e5)), hasta: fecha(new Date(new Date(lunes + "T12:00:00Z").getTime() + 40 * 864e5)) })]))).toMatch(/disponibles/);
      // Se avisa al jefe
      expect((await q("postgres", "select count(*)::int as n from public.notifications where user_id=$1 and ref_id=$2", [jefe.id, id])).rows[0].n).toBe(1);

      // El otro no ve la solicitud; en el calendario ve el puesto pero no el nombre
      expect((await q(otro, "select * from public.rrhh_solicitudes_ver()")).rows).toHaveLength(0);
      const cal = (await q(otro, "select * from public.rrhh_calendario($1, $2)", [lunes, miercoles])).rows.filter((r) => r.clase === "vacaciones");
      expect(cal[0]).toMatchObject({ puesto: "Almacenista", nombre: null, mio: false });
      expect((await q(ger, "select * from public.rrhh_calendario($1, $2)", [lunes, miercoles])).rows.find((r) => r.clase === "vacaciones")?.nombre).toBe("Empleado Uno");

      // Nadie se autoriza solo; el jefe da visto bueno, no autoriza; la gerente autoriza
      expect(await failure(q(otro, "select public.rrhh_resolver($1, 'aprobar')", [id]))).toMatch(/permiso/i);
      expect(await failure(q(jefe, "select public.rrhh_resolver($1, 'aprobar')", [id]))).toMatch(/gerente/);
      await q(jefe, "select public.rrhh_resolver($1, 'visto')", [id]);
      await q(ger, "select public.rrhh_resolver($1, 'aprobar', 'Disfruta')", [id]);
      const s1 = (await q(emp, "select * from public.rrhh_saldos()")).rows[0];
      expect(Number(s1.usados)).toBe(3);
      expect(Number(s1.disponible)).toBe(18);

      // Temporada general: la gerente elige 2 dias a descontar a todos
      const t1 = fecha(new Date(new Date(lunes + "T12:00:00Z").getTime() + 14 * 864e5));
      const t2 = fecha(new Date(new Date(lunes + "T12:00:00Z").getTime() + 15 * 864e5));
      const t3 = fecha(new Date(new Date(lunes + "T12:00:00Z").getTime() + 18 * 864e5));
      await q("postgres", "delete from public.rrhh_festivos where fecha between $1 and $2", [t1, t3]);
      expect(await failure(q(emp, "insert into public.rrhh_temporadas (nombre, desde, hasta) values ('X', $1, $2)", [t1, t3]))).toMatch(/row-level/);
      expect(await failure(q(ger, "insert into public.rrhh_temporadas (nombre, desde, hasta, dias_descuento) values ('X', $1, $2, $3)", [t1, t2, [t3]]))).toMatch(/dentro/);
      await q(ger, "insert into public.rrhh_temporadas (nombre, desde, hasta, dias_descuento) values ('Semana Santa', $1, $2, $3)", [t1, t3, [t1, t2]]);
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(16);
      // Los dias de temporada no se cuentan dos veces si pide vacaciones ahi
      expect((await q(emp, "select public.rrhh_contar_dias($1, $2) as n", [t1, t3])).rows[0].n).toBe(0);

      // Permiso: no descuenta dias y pide motivo
      expect(await failure(q(emp, "select public.rrhh_solicitar($1::jsonb)", [JSON.stringify({ tipo: "permiso", permiso_tipo: "llegar_tarde", desde: hoy })]))).toMatch(/motivo/);
      await q(emp, "select public.rrhh_solicitar($1::jsonb)", [JSON.stringify({ tipo: "permiso", permiso_tipo: "llegar_tarde", desde: hoy, hora: "10:00", motivo: "Cita medica" })]);
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(16);

      // Sin captura de la gerente no puede pedir vacaciones
      expect(await failure(q(otro, "select public.rrhh_solicitar($1::jsonb)", [JSON.stringify({ tipo: "vacaciones", desde: lunes, hasta: lunes })]))).toMatch(/gerente/);

      // Cancelar: el empleado cancela su autorizada futura y regresan los dias
      await q(emp, "select public.rrhh_cancelar($1)", [id]);
      expect(Number((await q(emp, "select * from public.rrhh_saldos()")).rows[0].disponible)).toBe(19);
      // Solo la gerente cambia las reglas
      const r = await q(emp, "update public.rrhh_config set sabado_laborable=false where id=1");
      expect(r.rowCount).toBe(0);
    });
  });
}
