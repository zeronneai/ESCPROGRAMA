"use client";

import { useEffect, useState } from "react";
import { crearRecepcionAction } from "@/actions/almacen";
import { ArticuloSearch } from "@/components/articulos-picker";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { TIPOS_RECEPCION, type TipoRecepcion } from "@/lib/almacen";

type Linea = { articulo_id: string; clave: string; nombre: string; cantidad: string; lote: string };

/** Nueva recepcion: articulos del catalogo y cantidad; al guardar se generan las etiquetas. */
export function RecepcionForm({ today, proveedores }: { today: string; proveedores: string[] }) {
  const [tipo, setTipo] = useState<TipoRecepcion>("compra");
  const [oc, setOc] = useState("");
  const [prov, setProv] = useState("");
  const [notas, setNotas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const { run, busy, notice, router } = useRun();
  const [formato, setFormato] = useState("carta");
  useEffect(() => {
    try {
      const f = localStorage.getItem("esc_formato_etiqueta");
      if (f) setFormato(f);
    } catch {}
  }, []);
  const elegirFormato = (f: string) => {
    setFormato(f);
    try {
      localStorage.setItem("esc_formato_etiqueta", f);
    } catch {}
  };
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
          <Field label="Fecha de recepción">
            <div className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-100 px-3 text-sm text-slate-700" title="La fecha es siempre el día en que se registra">
              {new Date(`${today}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
              <span className="ml-auto text-xs text-slate-500">Hoy (fija)</span>
            </div>
          </Field>
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

      <Card className="space-y-2 p-4 sm:p-5">
        <p className="font-semibold text-slate-900">¿Dónde vas a imprimir?</p>
        <div className="flex flex-wrap gap-2">
          {[["carta", "Hoja carta (recortar)"], ["50x25", "Etiquetadora 50 x 25 mm"], ["100x50", "Etiquetadora 100 x 50 mm"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => elegirFormato(k)} className={`rounded-full px-3 py-1.5 text-sm ${formato === k ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{label}</button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Al guardar se abre la impresión de las etiquetas. Pega una en cada caja.</p>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          loading={busy === "s"}
          disabled={!lineas.length || lineas.some((l) => !(Number(l.cantidad) > 0))}
          onClick={() =>
            run(
              "s",
              () => crearRecepcionAction({ tipo, orden_compra: oc, proveedor: prov, notas, lineas: lineas.map((l) => ({ articulo_id: l.articulo_id, cantidad: Number(l.cantidad), lote: l.lote })) }),
              (r) => r.ok && router.push(`/imprimir/etiquetas?recepcion=${r.id}&formato=${formato}&auto=1`),
            )
          }
        >
          Guardar e imprimir {total || ""} etiqueta(s)
        </Button>
        <span className="text-sm text-slate-500">{lineas.length} artículo(s)</span>
      </div>
    </div>
  );
}
