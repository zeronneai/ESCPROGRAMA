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
const art = async (clave: string) => (await q("postgres", "select id from public.articulos where clave=$1", [clave])).rows[0].id as string;

export function almacenSuite() {
  describe.skipIf(!DATABASE_URL)("Almacen: recepciones, etiquetas y carga", () => {
    it("recepcion crea una etiqueta por unidad; inventario; escaneo solo acepta lo facturado", async () => {
      const w = await createWorld();
      const alm = await user("almacen");
      const L = await art("ESC-GLPFGG-L");
      const M = await art("ESC-GLPFGG-M");
      const S = await art("ESC-GLPFGG-S");
      const lineas = JSON.stringify([{ articulo_id: L, cantidad: 3 }, { articulo_id: M, cantidad: 2 }, { articulo_id: S, cantidad: 1 }]);
      expect(await failure(q(w.seller1, "select public.recepcion_crear('compra', current_date, 'OC-1', 'Prov', null, $1::jsonb)", [lineas]))).toMatch(/Solo almacen/);
      const rec = (await q(alm.a, "select public.recepcion_crear('compra', date '2020-01-01', 'OC-1', 'Prov', null, $1::jsonb) as id", [lineas])).rows[0].id;
      // La fecha no se puede cambiar: siempre es el dia en que se registra.
      expect((await q("postgres", "select (fecha = public.local_today()) as hoy, (select bool_and(recibida = public.local_today()) from public.etiquetas where recepcion_id = $1) as ets from public.recepciones where id = $1", [rec])).rows[0]).toEqual({ hoy: true, ets: true });
      const et = (await q(w.seller1, "select codigo, articulo_id from public.etiquetas where recepcion_id=$1 order by codigo", [rec])).rows;
      expect(et).toHaveLength(6);
      expect(et[0].codigo).toMatch(/^E-\d{6}$/);
      const inv = (await q(w.seller1, "select clave, en_almacen::int from public.inventario_resumen() where articulo_id = any($1::uuid[]) order by clave", [[L, M, S]])).rows;
      expect(inv).toEqual([{ clave: "ESC-GLPFGG-L", en_almacen: 3 }, { clave: "ESC-GLPFGG-M", en_almacen: 2 }, { clave: "ESC-GLPFGG-S", en_almacen: 1 }]);

      // Vendedor sube la factura: 2 L y 1 M, y un flete sin clave
      const fl = JSON.stringify([{ clave: "esc-glpfgg-l", cantidad: 2, descripcion: "Guante L" }, { clave: "ESC-GLPFGG-M", cantidad: 1 }, { clave: null, cantidad: 1, descripcion: "Flete" }]);
      const folio = "F" + Math.floor(Math.random() * 1e8);
      const sal = (await q(w.seller1, "select public.salida_crear($1, current_date, 'Cliente X', 'DIANA', null, null, null, null, $2::jsonb) as id", [folio, fl])).rows[0].id;
      expect(await failure(q(w.seller1, "select public.salida_crear($1, current_date, 'X', null, null, null, null, null, $2::jsonb)", [folio.toLowerCase(), fl]))).toMatch(/No se puede subir dos veces/);
      // Otro vendedor tampoco puede, aunque lo escriba con guion o espacios, y se le avisa antes
      const variante = folio.slice(0, 1) + "-" + folio.slice(1, 4) + " " + folio.slice(4).toLowerCase();
      expect(await failure(q(w.seller2, "select public.salida_crear($1, current_date, 'X', null, null, null, null, null, $2::jsonb)", [variante, fl]))).toMatch(/ya se subio/);
      const usado = (await q(w.seller2, "select public.salida_folio_usado($1) as u", [variante])).rows[0].u;
      expect(usado).toMatchObject({ folio, estado: "por_cargar", puede_ver: false });
      expect((await q(w.seller2, "select public.salida_folio_usado('ZZ-999') as u")).rows[0].u).toBeNull();
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='salida_nueva' and ref_id=$1 and user_id=$2", [sal, alm.id])).rows[0].count)).toBe(1);
      expect((await q(w.seller2, "select id from public.salidas where id=$1", [sal])).rowCount).toBe(0);
      expect(await failure(q(w.seller1, "select public.salida_escanear($1,'E-000001')", [sal]))).toMatch(/Solo almacen/);

      const cod = (a: string) => et.filter((x) => x.articulo_id === a).map((x) => x.codigo as string);
      const scan = async (c: string) => (await q(alm.a, "select public.salida_escanear($1,$2) as r", [sal, c])).rows[0].r;
      expect(await scan(cod(S)[0])).toMatchObject({ ok: false, mensaje: expect.stringMatching(/NO CORRESPONDE/) });
      expect(await scan("hola")).toMatchObject({ ok: false, mensaje: "No es una etiqueta del sistema" });
      expect(await scan(cod(L)[0])).toMatchObject({ ok: true, clave: "ESC-GLPFGG-L", escaneadas: 1, cantidad: 2, faltan: 2 });
      expect(await scan(cod(L)[0])).toMatchObject({ ok: false, mensaje: expect.stringMatching(/ya se escaneo/) });
      expect(await scan(`https://x.mx/e/${cod(L)[1].toLowerCase()}`)).toMatchObject({ ok: true, faltan: 1 });
      expect(await scan(cod(L)[2])).toMatchObject({ ok: false, mensaje: expect.stringMatching(/Ya se cargo todo/) });
      expect(await failure(q(alm.a, "select public.salida_terminar($1)", [sal]))).toMatch(/Faltan 1/);
      // Quitar por error y volver a escanear
      await q(alm.a, "select public.salida_quitar($1,$2)", [sal, cod(L)[1]]);
      expect((await q(alm.a, "select estado from public.etiquetas where codigo=$1", [cod(L)[1]])).rows[0].estado).toBe("almacen");
      await scan(cod(L)[2]);
      expect(await scan(cod(M)[0])).toMatchObject({ ok: true, faltan: 0 });
      await q(alm.a, "select public.salida_terminar($1)", [sal]);
      const fin = (await q(w.seller1, "select estado, incompleta from public.salidas where id=$1", [sal])).rows[0];
      expect(fin).toEqual({ estado: "cargada", incompleta: false });
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='salida_cargada' and user_id=$1", [w.ids.s1])).rows[0].count)).toBe(1);
      // Otra factura no puede usar una etiqueta que ya salio
      const sal2 = (await q(w.seller1, "select public.salida_crear($1, null, null, null, null, null, null, null, $2::jsonb) as id", [folio + "B", JSON.stringify([{ clave: "ESC-GLPFGG-L", cantidad: 1 }])])).rows[0].id;
      expect((await q(alm.a, "select public.salida_escanear($1,$2) as r", [sal2, cod(L)[0]])).rows[0].r.mensaje).toMatch(/ya salio en la factura/);
      const log = (await q(w.seller1, "select count(*)::int as n, count(*) filter (where not ok)::int as malos from public.salida_escaneos where salida_id=$1", [sal])).rows[0];
      expect(log.malos).toBe(4);
      const inv2 = (await q(w.seller1, "select clave, en_almacen::int, cargadas::int from public.inventario_resumen() where articulo_id = any($1::uuid[]) order by clave", [[L, M]])).rows;
      expect(inv2).toEqual([{ clave: "ESC-GLPFGG-L", en_almacen: 1, cargadas: 2 }, { clave: "ESC-GLPFGG-M", en_almacen: 1, cargadas: 1 }]);
      // Cancelar regresa las etiquetas
      await q(alm.a, "select public.salida_escanear($1,$2)", [sal2, cod(L)[1]]);
      expect(await failure(q(w.seller2, "select public.salida_cancelar($1,'x')", [sal2]))).toMatch(/No autorizado/);
      await q(alm.a, "select public.salida_cancelar($1,'El cliente cancelo')", [sal2]);
      expect((await q(alm.a, "select estado from public.etiquetas where codigo=$1", [cod(L)[1]])).rows[0].estado).toBe("almacen");
      // Baja
      await q(alm.a, "select public.etiqueta_baja($1,'Caja danada')", [cod(S)[0]]);
      expect(await failure(q(alm.a, "select public.etiqueta_baja($1,'otra')", [cod(S)[0]]))).toMatch(/ya no esta en almacen/);
      expect(await failure(q("postgres", "delete from public.etiquetas where codigo=$1", [cod(S)[0]]))).toMatch(/inmutable|no se puede/i);
    });
  });
}
