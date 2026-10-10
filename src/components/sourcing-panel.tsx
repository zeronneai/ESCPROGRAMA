"use client";

import { useState, useTransition } from "react";
import { markPurchasedAction, saveSourcingAction } from "@/actions/sourcing";
import { emptySourcingValues, validateSourcing, type SourcingValues } from "@/lib/validation/sourcing";
import { Alert, Button, Field, Input } from "@/components/ui";

export const emptySourcing = emptySourcingValues;

/**
 * "Donde conseguirlo (interno)": solo comprador. Se puede editar aunque la partida ya este cotizada,
 * porque no afecta precios. El vendedor nunca ve esta informacion.
 */
export function SourcingPanel({
  itemId, values, setValues, proveedores, listId, showReminder, comprada,
}: {
  itemId: string;
  values: SourcingValues;
  setValues: (v: SourcingValues) => void;
  proveedores: string[];
  listId: string;
  /** Muestra el recordatorio cuando se cotiza sin proveedor ni link. */
  showReminder: boolean;
  comprada?: { at: string | null };
}) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const missing = !values.proveedor.trim() && !values.link_producto.trim();
  const set = (k: keyof SourcingValues, v: string) => setValues({ ...values, [k]: v });

  return (
    <details className="rounded-md border border-amber-200 bg-amber-50/40" open={showReminder || !missing}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Dónde conseguirlo (interno)
        <span className="ml-2 text-xs font-normal text-slate-500">Solo lo ve el comprador</span>
      </summary>
      <div className="space-y-3 border-t border-amber-200 p-3">
        {showReminder && missing && (
          <Alert tone="info">Recordatorio: esta partida no tiene proveedor ni link. Anótalos para saber a dónde ir si la cotización se aprueba.</Alert>
        )}
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Proveedor">
            <Input list={listId} value={values.proveedor} onChange={(e) => set("proveedor", e.target.value)} />
            <datalist id={listId}>{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Link del producto (http o https)">
            <Input value={values.link_producto} onChange={(e) => set("link_producto", e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="Contacto (nombre, teléfono o correo)">
            <Input value={values.contacto} onChange={(e) => set("contacto", e.target.value)} />
          </Field>
          <Field label="Número de parte o referencia del proveedor">
            <Input value={values.numero_parte} onChange={(e) => set("numero_parte", e.target.value)} />
          </Field>
        </div>
        <Field label="Notas de compra">
          <textarea value={values.notas_compra} onChange={(e) => set("notas_compra", e.target.value)} rows={2} placeholder='Ej. "pedir con 3 días de anticipación"' className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              const err = validateSourcing(values);
              if (err) return setNotice({ tone: "error", text: err });
              start(async () => {
                const r = await saveSourcingAction(itemId, values);
                setNotice(r.ok ? { tone: "success", text: "Datos de abastecimiento guardados" } : { tone: "error", text: r.error });
              });
            }}
          >
            Guardar abastecimiento
          </Button>
          {comprada !== undefined && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await markPurchasedAction(itemId, !comprada.at);
                  setNotice(r.ok ? { tone: "success", text: comprada.at ? "Marca de comprada quitada" : "Marcada como comprada" } : { tone: "error", text: r.error });
                })
              }
            >
              {comprada.at ? "Quitar marca de comprada" : "Marcar como comprada"}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
