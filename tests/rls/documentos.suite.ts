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

export function documentosSuite() {
  describe.skipIf(!DATABASE_URL)("Documentos y control de cambios", () => {
    it("solo el coordinador ISO sube documentos; todos los consultan; la version nueva reemplaza a la anterior", async () => {
      const w = await createWorld();
      const iso = await user("coordinador_iso");
      expect(await failure(q(w.buyer1, "insert into public.documentos (titulo, path, nombre_archivo) values ('X','a/b.pdf','b.pdf')"))).toMatch(/row-level security/);
      const d1 = (await q(iso.a, "insert into public.documentos (codigo, titulo, categoria, path, nombre_archivo) values ('ESC-SGC-PO-001','Política de calidad','Política','p/1.pdf','politica.pdf') returning id, autor_nombre, version, vigente")).rows[0];
      expect(d1).toMatchObject({ autor_nombre: "U coordinador_iso", version: "01", vigente: true });
      expect((await q(w.seller1, "select id from public.documentos where id=$1", [d1.id])).rowCount).toBe(1);
      expect((await q(w.seller1, "update public.documentos set titulo='y' where id=$1", [d1.id])).rowCount).toBe(0);
      const d2 = (await q(iso.a, "insert into public.documentos (codigo, titulo, categoria, version, path, nombre_archivo, reemplaza_id) values ('ESC-SGC-PO-001','Política de calidad','Política','02','p/2.pdf','politica2.pdf',$1) returning id", [d1.id])).rows[0];
      expect((await q(iso.a, "select vigente from public.documentos where id=$1", [d1.id])).rows[0].vigente).toBe(false);
      expect((await q(iso.a, "select vigente from public.documentos where id=$1", [d2.id])).rows[0].vigente).toBe(true);
      expect(await failure(q("postgres", "delete from public.documentos where id=$1", [d1.id]))).toMatch(/inmutable|no se puede/i);
      // Archivos: solo ISO sube
      expect(await failure(q(w.seller1, "insert into storage.objects (bucket_id, name) values ('documentos','z/x.pdf')"))).toMatch(/row-level security/);
      await q(iso.a, "insert into storage.objects (bucket_id, name) values ('documentos','z/x.pdf')");
    });

    it("control de cambios: lo llena ISO; gerente y comprador lo ven y reciben aviso; vendedor no", async () => {
      const w = await createWorld();
      const iso = await user("coordinador_iso");
      const ger = await user("gerente");
      expect(await failure(q(w.buyer1, "insert into public.control_cambios (documento_texto, descripcion, motivo) values ('Manual','Cambio','Motivo')"))).toMatch(/row-level security/);
      expect(await failure(q(iso.a, "insert into public.control_cambios (descripcion, motivo) values ('Cambio','Motivo')"))).toMatch(/control_cambios_documento/);
      const c = (await q(iso.a, "insert into public.control_cambios (documento_texto, descripcion, motivo, version_anterior, version_nueva) values ('Procedimiento de compras','Se agrega evaluación de proveedores','Auditoría interna','01','02') returning id, numero, estado")).rows[0];
      expect(c.numero).toMatch(/^CC-\d{4}-\d{3}$/);
      expect(c.estado).toBe("en_proceso");
      expect((await q(ger.a, "select id from public.control_cambios where id=$1", [c.id])).rowCount).toBe(1);
      expect((await q(w.buyer1, "select id from public.control_cambios where id=$1", [c.id])).rowCount).toBe(1);
      expect((await q(w.seller1, "select id from public.control_cambios where id=$1", [c.id])).rowCount).toBe(0);
      expect((await q(ger.a, "update public.control_cambios set estado='implementado' where id=$1", [c.id])).rowCount).toBe(0);
      expect((await q(iso.a, "update public.control_cambios set estado='implementado', fecha_implementacion=current_date where id=$1", [c.id])).rowCount).toBe(1);
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='control_cambio' and ref_id=$1 and user_id=$2", [c.id, ger.id])).rows[0].count)).toBe(1);
      expect(Number((await q("postgres", "select count(*) from public.notifications where tipo='control_cambio' and ref_id=$1 and user_id=$2", [c.id, w.ids.b1])).rows[0].count)).toBe(1);
    });
  });
}
