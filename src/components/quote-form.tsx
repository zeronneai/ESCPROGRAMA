"use client";

import { useMemo } from "react";
import { Field, Input, Select } from "@/components/ui";
import { calcTabulador, lineTotal, type PricingFactors } from "@/lib/pricing/tabulador";
import { UNIDADES } from "@/lib/validation/request";
import type { QuoteFormValues } from "@/lib/validation/response";

export type Factors = PricingFactors & { noShippingMarkup: string };

/** Campos de la cotizacion del comprador con vista previa en vivo de los 5 precios. */
export function QuoteForm({
  form, setForm, errors, factors, proveedores, cantidad, listId,
}: {
  form: QuoteFormValues;
  setForm: (f: QuoteFormValues) => void;
  errors: Record<string, string>;
  factors: Factors;
  proveedores: string[];
  cantidad: number | string | null;
  listId: string;
}) {
  const set = <K extends keyof QuoteFormValues>(k: K, v: QuoteFormValues[K]) => setForm({ ...form, [k]: v });
  const preview = useMemo(() => {
    const c = Number(form.costo.replace(/,/g, ""));
    const e = Number(form.envio.replace(/,/g, "") || 0);
    if (!form.costo.trim() || !(c > 0) || Number.isNaN(e) || e < 0) return null;
    try {
      return calcTabulador(c, e, factors);
    } catch {
      return null;
    }
  }, [form.costo, form.envio, factors]);
  const hasQty = cantidad !== null && Number(cantidad) > 0;
  const withShipping = Number(form.envio.replace(/,/g, "") || 0) > 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Costo del producto *" error={errors.costo}>
          <Input value={form.costo} onChange={(e) => set("costo", e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Costo de envío (opcional)" error={errors.envio}>
          <Input value={form.envio} onChange={(e) => set("envio", e.target.value)} inputMode="decimal" placeholder="0 = sin envío" />
        </Field>
        <Field label="Moneda *" error={errors.moneda}>
          <Select value={form.moneda} onChange={(e) => set("moneda", e.target.value)}>
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tiempo de entrega *">
          <Select value={form.entregaModo} onChange={(e) => set("entregaModo", e.target.value as "dias" | "fecha")}>
            <option value="dias">En días</option>
            <option value="fecha">Fecha estimada</option>
          </Select>
        </Field>
        {form.entregaModo === "dias" ? (
          <>
            <Field label="Días" error={errors.entregaDias}>
              <Input value={form.entregaDias} onChange={(e) => set("entregaDias", e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Tipo" error={errors.entregaTipo}>
              <Select value={form.entregaTipo} onChange={(e) => set("entregaTipo", e.target.value)}>
                <option value="habiles">Hábiles</option>
                <option value="naturales">Naturales</option>
              </Select>
            </Field>
          </>
        ) : (
          <Field label="Fecha" error={errors.entregaFecha}>
            <Input type="date" value={form.entregaFecha} onChange={(e) => set("entregaFecha", e.target.value)} />
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Compra mínima (opcional)">
          <Select value={form.minModo} onChange={(e) => set("minModo", e.target.value as QuoteFormValues["minModo"])}>
            <option value="ninguna">Sin mínimo</option>
            <option value="cantidad">Por cantidad</option>
            <option value="monto">Por monto</option>
          </Select>
        </Field>
        {form.minModo === "cantidad" && (
          <>
            <Field label="Cantidad mínima" error={errors.minCantidad}>
              <Input value={form.minCantidad} onChange={(e) => set("minCantidad", e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Unidad" error={errors.minUnidad}>
              <Select value={form.minUnidad} onChange={(e) => set("minUnidad", e.target.value)}>
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </Field>
          </>
        )}
        {form.minModo === "monto" && (
          <Field label={`Monto mínimo (${form.moneda})`} error={errors.minMonto}>
            <Input value={form.minMonto} onChange={(e) => set("minMonto", e.target.value)} inputMode="decimal" />
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Proveedor (opcional)">
          <Input list={listId} value={form.proveedor} onChange={(e) => set("proveedor", e.target.value)} />
          <datalist id={listId}>{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Nota (opcional, la ve el vendedor)">
          <Input value={form.nota} onChange={(e) => set("nota", e.target.value)} />
        </Field>
      </div>

      <div className="rounded-md bg-slate-50 p-3 text-sm">
        <p className="mb-1 font-medium">Vista previa</p>
        {preview ? (
          <div className="space-y-1">
            <p className="text-slate-600">Base de cálculo: ${preview.base} ({withShipping ? "costo + envío" : "costo + 4%"})</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-5">
              {(["p1", "p2", "p3", "p4", "p5"] as const).map((k, i) => (
                <div key={k} className="tabular-nums">
                  <span className="text-slate-500">Precio {i + 1}: </span>${preview[k]}
                  {hasQty && <div className="text-xs text-slate-500">Total ${lineTotal(preview[k], cantidad!)}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-slate-500">Captura el costo para ver los 5 precios.</p>
        )}
      </div>
    </div>
  );
}
