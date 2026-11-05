"use client";

import { useState } from "react";
import { crearRecepcionAction } from "@/actions/almacen";
import { ArticuloSearch } from "@/components/articulos-picker";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { TIPOS_RECEPCION, type TipoRecepcion } from "@/lib/almacen";

type Linea = { articulo_id: string; clave: string; nombre: string; cantidad: string; lote: string };

/** Nueva recepcion: articulos del catalogo y cantidad; al guardar se generan las etiquetas. */
export function RecepcionForm({ today, proveedores }: { today: string; proveedores: string[] }) {
  const [tipo, setTipo] = useState<TipoRecepcion>("compra");
  const [fecha, setFecha] = useState(today);
  const [oc, setOc] = useState("");
  const [prov, setProv] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const { run, busy, notice, router } = useRun();
  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0), 0);
  const set = (i: number, k: keyof Linea, v: string) => setLineas((x) => x.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card className="space-y-3 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <Field label="¿Qué se recibe?">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoRecepcion)}>
              {(Object.keys(TIPOS_RECEPCION) as TipoRecepcion[]).map((k) => <option key={k} value={k}>{TIPOS_RECEPCION[k]}</option>)}
            </Select>
          </Field>
          <Field label="Fecha de recepción"><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        </div>
        {tipo === "compra" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Orden de compra"><Input value={oc} onChange={(e) => setOc(e.target.value)} placeholder="Número de la OC física" /></Field>
            <Field label="Proveedor">
              <Input value={prov} onChange={(e) => setProv(e.target.value)} list="rec-proveedores" placeholder="Escribe o elige" />
              <datalist id="rec-proveedores">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
          </div>
        )}
        <Field label="Notas (opcional)"><Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder={tipo === "inventario_inicial" ? "Ej. Conteo de anaquel A" : "Ej. Llegó una caja golpeada"} /></Field>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <p className="font-semibold text-slate-900">Artículos recibidos</p>
          <p className="text-xs text-slate-500">Se imprime una etiqueta por cada unidad (por ejemplo, por cada caja master).</p>
        </div>
        <ArticuloSearch
          soloVendibles={false}
          exclude={lineas.map((l) => l.articulo_id)}
          placeholder="Buscar artículo por nombre o clave ESC-..."
          onPick={(a) => setLineas((x) => [...x, { articulo_id: a.id, clave: a.clave, nombre: a.nombre, cantidad: "", lote: "" }])}
        />
        {lineas.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {lineas.map((l, i) => (
              <li key={l.articulo_id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-slate-500">{l.clave}</p>
                  <p className="text-sm text-slate-900">{l.nombre}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input value={l.cantidad} onChange={(e) => set(i, "cantidad", e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Cantidad" aria-label="Cantidad" autoFocus={i === lineas.length - 1} className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  <input value={l.lote} onChange={(e) => set(i, "lote", e.target.value)} placeholder="Lote (opc.)" aria-label="Lote" className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  <button type="button" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} className="px-1 text-sm text-red-700">Quitar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          loading={busy === "s"}
          disabled={!lineas.length || lineas.some((l) => !(Number(l.cantidad) > 0))}
          onClick={() =>
            run(
              "s",
              () => crearRecepcionAction({ tipo, fecha, orden_compra: oc, proveedor: prov, notas, lineas: lineas.map((l) => ({ articulo_id: l.articulo_id, cantidad: Number(l.cantidad), lote: l.lote })) }),
              (r) => r.ok && router.push(`/almacen/recepciones/${r.id}?nueva=1`),
            )
          }
        >
          Guardar y generar {total || ""} etiqueta(s)
        </Button>
        <span className="text-sm text-slate-500">{lineas.length} artículo(s)</span>
      </div>
    </div>
  );
}
