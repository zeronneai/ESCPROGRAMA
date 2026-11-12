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
      expect(await failure(q(alm.a, "select public.salida_terminar($1, 'cierro asi')", [sal]))).toMatch(/Faltan 1 pieza/);
      // Sin material: queda en espera (no se cancela) y avisa al vendedor
      expect(await failure(q(alm.a, "select public.salida_espera($1, true, '')", [sal]))).toMatch(/Escribe el mensaje/);
      await q(alm.a, "select public.salida_espera($1, true, 'No hay talla M')", [sal]);
      expect((await q(w.seller1, "select estado, espera, espera_nota from public.salidas where id=$1", [sal])).rows[0]).toEqual({ estado: "cargando", espera: true, espera_nota: "No hay talla M" });
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='salida_espera' and user_id=$1", [w.ids.s1])).rows[0].count)).toBe(1);
      expect(await failure(q(w.seller1, "select public.salida_espera($1, false)", [sal]))).toMatch(/Solo almacen/);
      // Quitar por error y volver a escanear
      await q(alm.a, "select public.salida_quitar($1,$2)", [sal, cod(L)[1]]);
      expect((await q(alm.a, "select estado from public.etiquetas where codigo=$1", [cod(L)[1]])).rows[0].estado).toBe("almacen");
      await scan(cod(L)[2]);
      expect(await scan(cod(M)[0])).toMatchObject({ ok: true, faltan: 0 });
      await q(alm.a, "select public.salida_terminar($1)", [sal]);
      const fin = (await q(w.seller1, "select estado, incompleta, espera from public.salidas where id=$1", [sal])).rows[0];
      expect(fin).toEqual({ estado: "cargada", incompleta: false, espera: false });
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
      // Almacen ya no cancela; el vendedor tampoco si ya se empezo a cargar; la jefa de ventas si.
      expect(await failure(q(alm.a, "select public.salida_cancelar($1,'x')", [sal2]))).toMatch(/No autorizado/);
      expect(await failure(q(w.seller1, "select public.salida_cancelar($1,'x')", [sal2]))).toMatch(/No autorizado/);
      const jefa = await user("jefe_ventas");
      await q(jefa.a, "select public.salida_cancelar($1,'El cliente cancelo')", [sal2]);
      expect((await q(alm.a, "select estado from public.etiquetas where codigo=$1", [cod(L)[1]])).rows[0].estado).toBe("almacen");
      // Baja
      await q(alm.a, "select public.etiqueta_baja($1,'Caja danada')", [cod(S)[0]]);
      expect(await failure(q(alm.a, "select public.etiqueta_baja($1,'otra')", [cod(S)[0]]))).toMatch(/ya no esta en almacen/);
      expect(await failure(q("postgres", "delete from public.etiquetas where codigo=$1", [cod(S)[0]]))).toMatch(/inmutable|no se puede/i);
    });
    it("venta desde factura: cliente por RFC o nuevo, venta, entrega y entregada al cargar", async () => {
      const w = await createWorld();
      const alm = await user("almacen");
      const L = await art("ESC-GLPFGG-L");
      const rec = (await q(alm.a, "select public.recepcion_crear('compra', null, null, null, null, $1::jsonb) as id", [JSON.stringify([{ articulo_id: L, cantidad: 1 }])])).rows[0].id;
      const cod = (await q("postgres", "select codigo from public.etiquetas where recepcion_id=$1", [rec])).rows[0].codigo;
      const folio = "V" + Math.floor(Math.random() * 1e8);
      const rfc = "PEL" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0") + "AB1";
      const datos = (o: Record<string, unknown> = {}) => JSON.stringify({
        folio, fecha: null, uuid: randomUUID(), rfc, razon_social: "JUAN PRUEBA " + folio, nombre: "TACOS " + folio,
        direccion: "CALLE 1, CENTRO", telefono: "(614) 123-4567", pago: "credito", dias_credito: 7, total: 1160, moneda: "MXN",
        lineas: [{ clave: "ESC-GLPFGG-L", descripcion: "Guante L", cantidad: 1 }, { clave: null, descripcion: "Flete", cantidad: 1 }], ...o,
      });
      // Solo vendedores
      expect(await failure(q(alm.a, "select public.venta_desde_factura($1::jsonb)", [datos()]))).toMatch(/vendedores/);
      // Almacen desconectado (asi viene): la venta se registra pero no se manda a cargar.
      const off = (await q(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos({ folio: folio + "OFF", uuid: randomUUID(), rfc: null, nombre: "SIN ALMACEN " + folio, razon_social: null })])).rows[0].r;
      expect(off.venta_id).toBeTruthy();
      expect(off.salida_id).toBeNull();
      // Solo el comprador lo prende
      expect((await q(w.seller1, "update public.company_profile set almacen_ventas=true where id=true")).rowCount).toBe(0);
      expect((await q(w.buyer1, "update public.company_profile set almacen_ventas=true where id=true")).rowCount).toBe(1);
      const r = (await q(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos()])).rows[0].r;
      expect(r.cliente_nuevo).toBe(true);
      expect(r.salida_id).toBeTruthy();
      const c = (await q(w.seller1, "select nombre, tipo, rfc, razon_social, direccion, contacto_telefono from public.customers where id=$1", [r.customer_id])).rows[0];
      expect(c).toEqual({ nombre: "TACOS " + folio, tipo: "cliente", rfc, razon_social: "JUAN PRUEBA " + folio, direccion: "CALLE 1, CENTRO", contacto_telefono: "(614) 123-4567" });
      const v = (await q(w.seller1, "select factura, monto::float, pago, dias_credito, origen, entregado, vence = fecha + 7 as vence_ok, (select count(*)::int from public.venta_lineas where venta_id = ventas.id) as n from public.ventas where id=$1", [r.venta_id])).rows[0];
      expect(v).toEqual({ factura: folio, monto: 1160, pago: "credito", dias_credito: 7, origen: "factura", entregado: false, vence_ok: true, n: 2 });
      expect((await q(w.seller1, "select venta_id from public.salidas where id=$1", [r.salida_id])).rows[0].venta_id).toBe(r.venta_id);
      // Repetida (aunque cambie el formato del folio) no
      expect(await failure(q(w.seller1, "select public.venta_desde_factura($1::jsonb)", [datos({ folio: folio.toLowerCase() })]))).toMatch(/No se puede subir dos veces/);
      // Otra factura del mismo cliente: se encuentra por RFC (y desde Entregas tampoco se puede repetir)
      const r2 = (await q(w.seller1, "select public.venta_desde_factura($1::jsonb) as r", [datos({ folio: folio + "X", nombre: "OTRO NOMBRE", lineas: [{ clave: null, descripcion: "Servicio", cantidad: 1 }] })])).rows[0].r;
      expect(r2).toMatchObject({ customer_id: r.customer_id, cliente_nuevo: false, salida_id: null });
      await q("postgres", "update public.company_profile set almacen_ventas=false where id=true");
      expect(await failure(q(w.seller2, "select public.salida_crear($1, null, null, null, null, null, null, null, $2::jsonb)", [folio + "X", JSON.stringify([{ clave: "ESC-GLPFGG-L", cantidad: 1 }])]))).toMatch(/registrada como venta/);
      // Al terminar la carga, la venta queda entregada
      await q(alm.a, "select public.salida_escanear($1,$2)", [r.salida_id, cod]);
      await q(alm.a, "select public.salida_terminar($1)", [r.salida_id]);
      expect((await q(w.seller1, "select entregado from public.ventas where id=$1", [r.venta_id])).rows[0].entregado).toBe(true);
    });
  });
}
