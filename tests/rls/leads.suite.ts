import { beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL, as, failure } from "./helpers";
import { createWorld, type World } from "./fixtures";

let w: World;

const newLead = (actor: World["seller1"], vendedor: string, extra: Record<string, unknown> = {}) =>
  as(actor, async (q) => {
    const cols = ["vendedor_id", "empresa", "created_by", ...Object.keys(extra)];
    const vals = [vendedor, `Empresa ${Math.random().toString(36).slice(2, 8)}`, vendedor, ...Object.values(extra)];
    const r = await q(
      `insert into public.leads (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
      vals,
    );
    return r.rows[0].id as string;
  });

const leadRow = async (id: string) => (await as("postgres", (q) => q("select * from public.leads where id=$1", [id]))).rows[0];

export function leadsSuite() {
  describe.skipIf(!DATABASE_URL)("Leads (solo vendedores)", () => {
    beforeAll(async () => {
      w = await createWorld();
    });

    it("el vendedor crea y ve sus leads; otro vendedor y el comprador no los ven", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      const own = await as(w.seller1, (q) => q("select id from public.leads where id=$1", [id]));
      expect(own.rowCount).toBe(1);
      const other = await as(w.seller2, (q) => q("select id from public.leads where id=$1", [id]));
      expect(other.rowCount).toBe(0);
      const buyer = await as(w.buyer1, (q) => q("select id from public.leads where id=$1", [id]));
      expect(buyer.rowCount).toBe(0);
    });

    it("no se puede crear un lead a nombre de otro vendedor ni como comprador", async () => {
      expect(await failure(newLead(w.seller1, w.ids.s2))).toMatch(/row-level security/);
      expect(await failure(newLead(w.buyer1, w.ids.b1))).toMatch(/row-level security/);
    });

    it("otro vendedor no puede editar ni registrar actividad en un lead ajeno", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      const upd = await as(w.seller2, (q) => q("update public.leads set notas='x' where id=$1", [id]));
      expect(upd.rowCount).toBe(0);
      expect(
        await failure(as(w.seller2, (q) => q("insert into public.lead_activities (lead_id, tipo, created_by) values ($1,'llamada',$2)", [id, w.ids.s2]))),
      ).toMatch(/row-level security/);
    });

    it("el primer contacto pasa el lead de nuevo a contactado y registra ultimo contacto", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      await as(w.seller1, (q) => q("insert into public.lead_activities (lead_id, tipo, resultado, created_by) values ($1,'llamada','Contestó',$2)", [id, w.ids.s1]));
      const l = await leadRow(id);
      expect(l.etapa).toBe("contactado");
      expect(l.ultimo_contacto_at).not.toBeNull();
      const acts = await as(w.seller1, (q) => q("select tipo, etapa_antes, etapa_despues from public.lead_activities where lead_id=$1 order by created_at", [id]));
      expect(acts.rows.map((r) => r.tipo)).toEqual(["llamada", "cambio_etapa"]);
    });

    it("una nota no cambia la etapa ni el ultimo contacto", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      await as(w.seller1, (q) => q("insert into public.lead_activities (lead_id, tipo, nota, created_by) values ($1,'nota','solo nota',$2)", [id, w.ids.s1]));
      const l = await leadRow(id);
      expect(l.etapa).toBe("nuevo");
      expect(l.ultimo_contacto_at).toBeNull();
    });

    it("el vendedor no puede insertar a mano un cambio de etapa ni editar o borrar actividades", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      expect(
        await failure(as(w.seller1, (q) => q("insert into public.lead_activities (lead_id, tipo, created_by) values ($1,'cambio_etapa',$2)", [id, w.ids.s1]))),
      ).toMatch(/row-level security/);
      await as(w.seller1, (q) => q("insert into public.lead_activities (lead_id, tipo, created_by) values ($1,'nota',$2)", [id, w.ids.s1]));
      expect(await failure(as("postgres", (q) => q("delete from public.lead_activities where lead_id=$1", [id])))).toBeTruthy();
      expect(await failure(as(w.seller1, (q) => q("delete from public.leads where id=$1", [id])))).toMatch(/permission denied/);
    });

    it("perdido exige motivo; al reabrir se limpia el motivo y queda la actividad", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      expect(await failure(as(w.seller1, (q) => q("update public.leads set etapa='perdido' where id=$1", [id])))).toMatch(/check/);
      await as(w.seller1, (q) => q("update public.leads set etapa='perdido', motivo_perdida='Precio' where id=$1", [id]));
      await as(w.seller1, (q) => q("update public.leads set etapa='interesado' where id=$1", [id]));
      const l = await leadRow(id);
      expect(l.motivo_perdida).toBeNull();
      const acts = await as(w.seller1, (q) => q("select etapa_despues from public.lead_activities where lead_id=$1 and tipo='cambio_etapa' order by created_at", [id]));
      expect(acts.rows.map((r) => r.etapa_despues)).toEqual(["perdido", "interesado"]);
    });

    it("un lead sin vendedor lo ven todos los vendedores y uno lo puede tomar", async () => {
      const id = (await as("postgres", (q) => q("insert into public.leads (empresa, origen) values ('Desde la web', 'sitio_web') returning id"))).rows[0].id;
      for (const s of [w.seller1, w.seller2]) {
        expect((await as(s, (q) => q("select id from public.leads where id=$1", [id]))).rowCount).toBe(1);
      }
      await as(w.seller2, (q) => q("update public.leads set vendedor_id=$2 where id=$1", [id, w.ids.s2]));
      expect((await leadRow(id)).vendedor_id).toBe(w.ids.s2);
      expect((await as(w.seller1, (q) => q("select id from public.leads where id=$1", [id]))).rowCount).toBe(0);
      // No se puede regalar el lead a otro vendedor.
      expect(await failure(as(w.seller2, (q) => q("update public.leads set vendedor_id=$2 where id=$1", [id, w.ids.s1])))).toMatch(/row-level security/);
    });

    it("convertir a cliente crea (o reutiliza) el cliente y marca ganado", async () => {
      const id = await newLead(w.seller1, w.ids.s1, { contacto_nombre: "Ana", correo: "ana@x.com", telefono: "6141234567" });
      const r = await as(w.seller1, (q) => q("select public.convert_lead_to_customer($1, null) as c", [id]));
      const customer = r.rows[0].c as string;
      const l = await leadRow(id);
      expect(l.etapa).toBe("ganado");
      expect(l.ganado_at).not.toBeNull();
      expect(l.customer_id).toBe(customer);
      const c = (await as("postgres", (q) => q("select tipo, contacto_correo from public.customers where id=$1", [customer]))).rows[0];
      expect(c).toEqual({ tipo: "cliente", contacto_correo: "ana@x.com" });
      expect(await failure(as(w.seller2, (q) => q("select public.convert_lead_to_customer($1, null)", [id])))).toMatch(/No autorizado/);
    });

    it("vincular para cotizar crea un cliente prospecto sin cambiar la etapa", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      const r = await as(w.seller1, (q) => q("select public.link_lead_customer($1) as c", [id]));
      const c = (await as("postgres", (q) => q("select tipo from public.customers where id=$1", [r.rows[0].c]))).rows[0];
      expect(c.tipo).toBe("prospecto");
      expect((await leadRow(id)).etapa).toBe("nuevo");
    });

    it("los cambios quedan en la bitacora de auditoria", async () => {
      const id = await newLead(w.seller1, w.ids.s1);
      await as(w.seller1, (q) => q("update public.leads set prioridad='alta' where id=$1", [id]));
      const a = await as("postgres", (q) => q("select action from public.audit_log where entity='leads' and entity_id=$1 order by id", [id]));
      expect(a.rows.map((r) => r.action)).toEqual(["insert", "update"]);
    });
  });
}
