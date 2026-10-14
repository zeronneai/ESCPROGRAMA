import { describe, expect, it } from "vitest";
import { followUpState, formatFollowUp, relativeDays } from "@/lib/leads/format";
import { computeLeadStats, type StatLead } from "@/lib/leads/stats";
import { whatsappNumber } from "@/lib/leads/types";
import { leadSchema } from "@/lib/validation/lead";

const TZ = "America/Chihuahua";
const NOW = new Date("2026-10-14T18:00:00Z"); // 12:00 en Chihuahua, miercoles

const lead = (o: Partial<StatLead> = {}): StatLead => ({
  etapa: "nuevo",
  origen: "llamada_fria",
  created_at: "2026-10-02T16:00:00Z",
  ganado_at: null,
  etapa_at: "2026-10-02T16:00:00Z",
  proximo_seguimiento: null,
  valor_estimado: null,
  moneda: "MXN",
  archived_at: null,
  ...o,
});

describe("computeLeadStats", () => {
  const leads: StatLead[] = [
    lead(),
    lead({ etapa: "contactado", proximo_seguimiento: "2026-10-10", valor_estimado: "1000" }),
    lead({ etapa: "cotizando", proximo_seguimiento: "2026-10-14", valor_estimado: 500, origen: "sitio_web" }),
    lead({ etapa: "ganado", ganado_at: "2026-10-05T16:00:00Z", origen: "sitio_web" }),
    lead({ etapa: "ganado", ganado_at: "2026-08-05T16:00:00Z", created_at: "2026-07-01T16:00:00Z" }),
    lead({ etapa: "perdido" }),
    lead({ etapa: "contactado", archived_at: "2026-10-03T00:00:00Z" }),
  ];
  const acts = [
    { tipo: "llamada" as const, created_at: "2026-10-13T16:00:00Z" },
    { tipo: "llamada" as const, created_at: "2026-10-01T16:00:00Z" },
    { tipo: "whatsapp" as const, created_at: "2026-10-12T16:00:00Z" },
    { tipo: "correo" as const, created_at: "2026-10-06T16:00:00Z" },
    { tipo: "visita" as const, created_at: "2026-10-07T16:00:00Z" },
    { tipo: "nota" as const, created_at: "2026-10-07T16:00:00Z" },
    { tipo: "llamada" as const, created_at: "2026-09-20T16:00:00Z" },
  ];
  const s = computeLeadStats(leads, acts, NOW, TZ);

  it("ignora archivados y cuenta activos, ganados y perdidos", () => {
    expect(s.total).toBe(6);
    expect(s.activos).toBe(3);
    expect(s.ganados).toBe(2);
    expect(s.ganadosMes).toBe(1);
    expect(s.perdidos).toBe(1);
    expect(s.tasaConversion).toBeCloseTo(2 / 3);
    expect(s.sinContactar).toBe(1);
    expect(s.nuevosMes).toBe(5);
  });

  it("seguimientos vencidos y de hoy solo en leads abiertos", () => {
    expect(s.seguimientosVencidos).toBe(1);
    expect(s.seguimientosHoy).toBe(1);
  });

  it("contactos del mes por tipo; las notas no son contacto", () => {
    expect(s.contactosMes).toEqual({ llamadas: 2, mensajes: 1, correos: 1, visitas: 1, total: 5 });
  });

  it("embudo con todas las etapas en orden", () => {
    expect(s.porEtapa.map((e) => [e.etapa, e.count])).toEqual([
      ["nuevo", 1], ["contactado", 1], ["interesado", 0], ["cotizando", 1], ["negociacion", 0], ["ganado", 2], ["perdido", 1],
    ]);
  });

  it("origen con ganados, semanas y meses fijos", () => {
    expect(s.porOrigen[0]).toEqual({ label: "Llamada en frío", count: 4, ganados: 1 });
    expect(s.porOrigen[1]).toEqual({ label: "Sitio web", count: 2, ganados: 1 });
    expect(s.actividadSemanal).toHaveLength(8);
    expect(s.actividadSemanal.at(-1)).toEqual({ semana: "2026-10-12", llamadas: 1, mensajes: 1, visitas: 0 });
    expect(s.porMes.map((m) => m.mes)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.porMes.at(-1)).toEqual({ mes: "2026-10", nuevos: 5, ganados: 1 });
    expect(s.porMes[2]).toEqual({ mes: "2026-07", nuevos: 1, ganados: 0 });
  });

  it("valor en proceso solo de leads abiertos", () => {
    expect(s.pipeline).toEqual([{ moneda: "MXN", valor: 1500, leads: 2 }]);
  });
});

describe("formato de leads", () => {
  it("dias relativos", () => {
    expect(relativeDays(null, NOW, TZ)).toBe("Nunca");
    expect(relativeDays("2026-10-14T15:00:00Z", NOW, TZ)).toBe("Hoy");
    expect(relativeDays("2026-10-13T15:00:00Z", NOW, TZ)).toBe("Ayer");
    expect(relativeDays("2026-10-04T15:00:00Z", NOW, TZ)).toBe("Hace 10 días");
  });
  it("seguimiento", () => {
    expect(followUpState("2026-10-13", NOW, TZ)).toBe("vencido");
    expect(followUpState("2026-10-14", NOW, TZ)).toBe("hoy");
    expect(followUpState("2026-10-16", NOW, TZ)).toBe("pronto");
    expect(followUpState("2026-11-01", NOW, TZ)).toBe("futuro");
    expect(formatFollowUp("2026-10-14", NOW, TZ)).toBe("Hoy");
  });
  it("numero de WhatsApp", () => {
    expect(whatsappNumber("(614) 424-6200")).toBe("526144246200");
    expect(whatsappNumber("+1 915 555 1234")).toBe("19155551234");
    expect(whatsappNumber("123")).toBeNull();
  });
});

describe("validacion de lead", () => {
  const base = { empresa: "Planta Norte", origen: "referido" as const, telefono: "614 123 4567" };
  it("acepta lo minimo y limpia vacios", () => {
    const r = leadSchema.parse({ ...base, correo: "", valor_estimado: "$12,500.50" });
    expect(r.correo).toBeNull();
    expect(r.valor_estimado).toBe(12500.5);
    expect(r.etapa).toBe("nuevo");
  });
  it("exige algun dato de contacto", () => {
    expect(leadSchema.safeParse({ empresa: "X SA", origen: "otro" }).success).toBe(false);
  });
  it("perdido exige motivo", () => {
    expect(leadSchema.safeParse({ ...base, etapa: "perdido" }).success).toBe(false);
    expect(leadSchema.safeParse({ ...base, etapa: "perdido", motivo_perdida: "Precio" }).success).toBe(true);
  });
  it("rechaza correo invalido", () => {
    expect(leadSchema.safeParse({ ...base, correo: "nope" }).success).toBe(false);
  });
});
