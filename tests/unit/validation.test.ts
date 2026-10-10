import { describe, expect, it } from "vitest";
import { formatProblems, parseNumber, submitProblems, toDraftPayload } from "@/lib/validation/request";
import { emptyQuoteForm, parseNotFoundNote, parseQuoteForm } from "@/lib/validation/response";

const ref = { tipo: "link", url: "https://a.com/x" };
const ok = { producto: "Guante", descripcion: "Guante de carnaza", cantidad: "10", unidad: "par", talla: "", refs: [ref] };

describe("submitProblems", () => {
  it("partida completa sin problemas", () => {
    expect(submitProblems({ customer_id: "c", items: [ok] })).toEqual([]);
  });
  it("sin cliente ni partidas", () => {
    const p = submitProblems({ customer_id: "", items: [] });
    expect(p.map((x) => x.field)).toEqual(["customer", "items"]);
  });
  it("nombre, descripcion corta, cantidad/talla y referencia son obligatorios", () => {
    const p = submitProblems({ customer_id: "c", items: [{ producto: " ", descripcion: "corta", cantidad: "", unidad: "", talla: "", refs: [] }] });
    expect(p.map((x) => x.field)).toEqual(["producto", "descripcion", "cantidad", "referencias"]);
  });
  it("talla sola basta; cantidad sin unidad no", () => {
    expect(submitProblems({ customer_id: "c", items: [{ ...ok, cantidad: "", unidad: "", talla: "M" }] })).toEqual([]);
    const p = submitProblems({ customer_id: "c", items: [{ ...ok, unidad: "" }] });
    expect(p[0].message).toMatch(/unidad/);
  });
  it("cantidad cero o negativa se rechaza", () => {
    expect(submitProblems({ customer_id: "c", items: [{ ...ok, cantidad: "0" }] })[0].message).toMatch(/mayor a 0/);
    expect(submitProblems({ customer_id: "c", items: [{ ...ok, cantidad: "-3" }] })[0].message).toMatch(/mayor a 0/);
  });
  it("indica la partida exacta", () => {
    const p = submitProblems({ customer_id: "c", items: [ok, { ...ok, producto: "" }] });
    expect(p).toEqual([{ item: 1, field: "producto", message: "Partida 2: falta el nombre del producto" }]);
  });
});

describe("formatProblems / toDraftPayload", () => {
  it("rechaza links que no son http(s) y unidades invalidas", () => {
    const p = formatProblems({ items: [{ ...ok, refs: [{ id: "x", tipo: "link", url: "javascript:alert(1)" }] as never, unidad: "galon" }] });
    expect(p.length).toBe(2);
  });
  it("payload: cantidad numerica, sin unidad si no hay cantidad", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const d = toDraftPayload({
      request_id: id, customer_id: id, notas: "", atencion: "", destino_entrega: "",
      items: [{ id, producto: "a", descripcion: "b", cantidad: "1,250.5", unidad: "kg", talla: "", notas: "", refs: [] },
              { id, producto: "a", descripcion: "b", cantidad: "", unidad: "kg", talla: "M", notas: "", refs: [] }],
    });
    expect(d.items[0]).toMatchObject({ cantidad: 1250.5, unidad: "kg" });
    expect(d.items[1]).toMatchObject({ cantidad: null, unidad: null, talla: "M" });
  });
  it("parseNumber", () => {
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber(" 12 ")).toBe(12);
    expect(parseNumber("abc")).toBeNaN();
  });
});

describe("parseQuoteForm", () => {
  const base = { ...emptyQuoteForm, costo: "100", entregaDias: "5" };
  it("cotizacion minima valida", () => {
    const r = parseQuoteForm(base);
    expect(r).toMatchObject({ ok: true, value: { costo: 100, envio: null, moneda: "MXN", entrega: { dias: 5, tipo: "habiles", fecha: null } } });
  });
  it("envio 0 o vacio es sin envio", () => {
    expect((parseQuoteForm({ ...base, envio: "0" }) as { value: { envio: null } }).value.envio).toBeNull();
    expect((parseQuoteForm({ ...base, envio: "12.5" }) as { value: { envio: number } }).value.envio).toBe(12.5);
  });
  it("costo y entrega obligatorios", () => {
    const r = parseQuoteForm({ ...emptyQuoteForm });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors)).toEqual(expect.arrayContaining(["costo", "entregaDias"]));
  });
  it("entrega por fecha y monto minimo adicional opcional", () => {
    const r = parseQuoteForm({ ...base, entregaModo: "fecha", entregaFecha: "2026-05-01", minMonto: "1500" });
    expect(r).toMatchObject({ ok: true, value: { entrega: { fecha: "2026-05-01", dias: null }, compra_min: { cantidad: 1, unidad: "pieza", monto: 1500 } } });
  });
  it("compra minima OBLIGATORIA: por defecto 1 pieza; vacia, menor a 1 o con unidad invalida no pasa", () => {
    expect(emptyQuoteForm.minCantidad).toBe("1");
    expect(parseQuoteForm(base)).toMatchObject({ ok: true, value: { compra_min: { cantidad: 1, unidad: "pieza", monto: null } } });
    expect(parseQuoteForm({ ...base, minCantidad: "10", minUnidad: "caja" })).toMatchObject({ ok: true, value: { compra_min: { cantidad: 10, unidad: "caja" } } });
    for (const minCantidad of ["", "0", "0.5", "-2", "abc"]) {
      const r = parseQuoteForm({ ...base, minCantidad });
      expect(r.ok, minCantidad).toBe(false);
      expect(!r.ok && r.errors.minCantidad).toBeTruthy();
    }
    expect(parseQuoteForm({ ...base, minCantidad: "10", minUnidad: "x" }).ok).toBe(false);
    expect(parseQuoteForm({ ...base, minMonto: "0" }).ok).toBe(false);
  });
  it("nota de no encontrada es obligatoria", () => {
    expect(parseNotFoundNote("   ").ok).toBe(false);
    expect(parseNotFoundNote(" sin proveedor ")).toEqual({ ok: true, value: { nota: "sin proveedor" } });
  });
});

describe("producto alternativo en la respuesta del comprador", () => {
  const form = { ...emptyQuoteForm, costo: "100", entregaDias: "5" };

  it("por defecto el precio es del producto solicitado (sin alternativo)", () => {
    const r = parseQuoteForm(form) as { ok: true; value: { alternativo: unknown } };
    expect(r.ok).toBe(true);
    expect(r.value.alternativo).toBeNull();
  });

  it("alternativo: nombre y nota de por que sirve son obligatorios; presentacion opcional", () => {
    const sin = parseQuoteForm({ ...form, precioDe: "alternativo" });
    expect(sin.ok).toBe(false);
    expect((sin as { errors: Record<string, string> }).errors).toMatchObject({ altNombre: expect.any(String), altMotivo: expect.any(String) });
    const ok = parseQuoteForm({ ...form, precioDe: "alternativo", altNombre: " Guante de nylon ", altMotivo: " Mismo uso ", altDescripcion: "" }) as { ok: true; value: { alternativo: unknown } };
    expect(ok.value.alternativo).toEqual({ nombre: "Guante de nylon", descripcion: null, motivo: "Mismo uso" });
  });

  it("limites de longitud", () => {
    const largo = parseQuoteForm({ ...form, precioDe: "alternativo", altNombre: "x".repeat(201), altMotivo: "ok" });
    expect((largo as { errors: Record<string, string> }).errors.altNombre).toMatch(/200/);
  });

  it("si vuelve a producto solicitado, los datos del alternativo se descartan", () => {
    const r = parseQuoteForm({ ...form, precioDe: "solicitado", altNombre: "Guante", altMotivo: "x" }) as { ok: true; value: { alternativo: unknown } };
    expect(r.value.alternativo).toBeNull();
  });
});

