import { describe, expect, it } from "vitest";
import { sacSchema } from "@/lib/ops/calidad";
import { avanceLabel, consumoSchema } from "@/lib/ops/consumo";
import { canRemind, elapsedText, guiaAlert, guiaSchema, guiaTitle } from "@/lib/ops/guias";

const now = new Date("2026-11-02T18:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("guias", () => {
  it("titulo: factura, persona o negocio y paqueteria", () => {
    expect(guiaTitle({ factura: "A-123", destinatario: "Foxconn", paqueteria: "Paquete Express" })).toBe("A-123 · Foxconn · Paquete Express");
    expect(guiaTitle({ factura: "A-1", destinatario: "Juan", paqueteria: "Otra", paqueteria_otra: "Fletes Juárez" })).toBe("A-1 · Juan · Fletes Juárez");
  });
  it("alerta ambar a las 4 horas y roja a las 24; nada si ya esta lista", () => {
    expect(guiaAlert({ estado: "solicitada", solicitada_at: ago(1) }, now)).toBeNull();
    expect(guiaAlert({ estado: "en_proceso", solicitada_at: ago(5) }, now)).toBe("ambar");
    expect(guiaAlert({ estado: "solicitada", solicitada_at: ago(25) }, now)).toBe("roja");
    expect(guiaAlert({ estado: "lista", solicitada_at: ago(30) }, now)).toBeNull();
  });
  it("recordar: a partir de 4 horas y uno por hora", () => {
    expect(canRemind({ estado: "solicitada", solicitada_at: ago(3), ultimo_recordatorio_at: null }, now)).toMatchObject({ ok: false, reason: "Podrás recordar en 1 h 0 min" });
    expect(canRemind({ estado: "solicitada", solicitada_at: ago(4.5), ultimo_recordatorio_at: null }, now).ok).toBe(true);
    expect(canRemind({ estado: "solicitada", solicitada_at: ago(6), ultimo_recordatorio_at: ago(0.5) }, now).ok).toBe(false);
    expect(canRemind({ estado: "lista", solicitada_at: ago(6), ultimo_recordatorio_at: null }, now).ok).toBe(false);
    expect(elapsedText(0.2)).toBe("12 min");
    expect(elapsedText(30)).toBe("30 h");
    expect(elapsedText(72)).toBe("3 días");
  });
  it("valida datos minimos para generar la guia", () => {
    const base = { factura: "A-1", destinatario: "Foxconn", paqueteria: "DHL", servicio: "estandar", telefono: "6561234567", calle_numero: "Av. 1 100", cp: "32000", ciudad: "Juárez", estado_geo: "Chihuahua", bultos: "1", peso_kg: "2.5" };
    expect(guiaSchema.safeParse(base).success).toBe(true);
    expect(guiaSchema.safeParse({ ...base, cp: "320" }).error?.issues[0].message).toMatch(/5 dígitos/);
    expect(guiaSchema.safeParse({ ...base, paqueteria: "Otra" }).error?.issues[0].message).toMatch(/cuál/);
    expect(guiaSchema.parse({ ...base, largo_cm: "" }).largo_cm).toBeNull();
  });
});

describe("consumo interno y calidad", () => {
  it("consumo: textos por tipo y validacion", () => {
    expect(avanceLabel("servicio", "en_proceso")).toBe("Agendado");
    expect(avanceLabel("producto", "completada")).toBe("Recibido");
    expect(consumoSchema.safeParse({ tipo: "producto", categoria: "papeleria", descripcion: "Hojas", cantidad: "0", motivo: "Se acabaron" }).success).toBe(false);
    expect(consumoSchema.parse({ tipo: "producto", categoria: "papeleria", descripcion: "Hojas", cantidad: "2", motivo: "Se acabaron" }).cantidad).toBe(2);
  });
  it("accion correctiva: quita filas vacias y exige especificar 'Otros'", () => {
    const base = {
      fecha: "2026-11-02", solicitante: "Coord", fuente: "auditoria", descripcion: "Faltante en embarque", equipo: [{ nombre: "", puesto: "" }],
      causas: {}, plan: [{ actividad: "", responsable: "", fecha: "", reprogramacion: "", hecho: false }], verificacion: [], estado: "abierta",
    };
    const r = sacSchema.parse(base);
    expect(r.equipo).toEqual([]);
    expect(r.plan).toEqual([]);
    expect(r.fecha_cierre).toBeNull();
    expect(sacSchema.safeParse({ ...base, fuente: "otro" }).error?.issues[0].message).toMatch(/Otros/);
  });
});
