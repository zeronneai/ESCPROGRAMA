"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { crearPedidoPegatronAction, poPegatronUsadaAction } from "@/actions/pegatron";
import { irACampo } from "@/components/feedback-global";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { leerOcPegatron, textosPdf } from "@/lib/pegatron-po";

type Renglon = { key: string; item: string; numero_parte: string; descripcion: string; cantidad: string; unidad: string; entrega: string; articulo_esc: string };
const nuevo = (): Renglon => ({ key: Math.random().toString(36).slice(2), item: "", numero_parte: "", descripcion: "", cantidad: "", unidad: "", entrega: "", articulo_esc: "" });

export type TipoPegatron = "linea" | "sobrepedido";
export const TIPOS_PEGATRON: Record<TipoPegatron, { label: string; ayuda: string }> = {
  linea: { label: "De línea", ayuda: "Productos de importación que manejamos siempre. Entran a la planeación de compras." },
  sobrepedido: { label: "Sobrepedido", ayuda: "Productos locales o no comunes que se piden aparte." },
};

export function NuevaOcPegatron({ catalogo = [] }: { catalogo?: { clave: string; nombre: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [arrastra, setArrastra] = useState(false);
  const [po, setPo] = useState("");
  const [fecha, setFecha] = useState("");
  const [moneda, setMoneda] = useState<"" | "USD" | "MXN">("");
  const [notas, setNotas] = useState("");
  const [rs, setRs] = useState<Renglon[]>([]);
  const [aviso, setAviso] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [usada, setUsada] = useState<{ id: string; folio: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tipo, setTipo] = useState<TipoPegatron | "">("");

  async function leer(f: File | null | undefined) {
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) return setAviso({ tone: "error", text: "Sube la orden de compra en PDF." });
    setFile(f);
    setAviso(null);
    setUsada(null);
    setLeyendo(true);
    try {
      const oc = leerOcPegatron(await textosPdf(f));
      setPo(oc.po_numero);
      setFecha(oc.fecha ?? "");
      setMoneda(oc.moneda ?? "");
      setRs(oc.lineas.map((l) => ({ ...nuevo(), item: l.item, numero_parte: l.numero_parte, descripcion: l.descripcion, cantidad: String(l.cantidad), unidad: l.unidad, entrega: l.entrega ?? "" })));
      if (oc.po_numero) setUsada(await poPegatronUsadaAction(oc.po_numero).catch(() => null));
      setAviso(
        oc.lineas.length
          ? { tone: "success", text: `Leímos ${oc.lineas.length} renglón(es). Escribe el artículo ESC de cada uno y guarda.` }
          : { tone: "error", text: "No encontramos los renglones en el PDF. Agrégalos a mano con \"+ Agregar renglón\"." },
      );
      if (!oc.lineas.length) setRs([nuevo()]);
    } catch {
      setAviso({ tone: "error", text: "No pudimos leer el PDF. Captura los renglones a mano." });
      setRs([nuevo()]);
    } finally {
      setLeyendo(false);
    }
  }

  const set = (i: number, k: keyof Renglon, v: string) => setRs((a) => a.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const faltan = rs.filter((r) => r.articulo_esc.trim().length < 2).length;

  async function guardar() {
    setAviso(null);
    if (!tipo) return irACampo('[data-campo="tipo-pegatron"]', "Elige si la orden es De línea o Sobrepedido.");
    if (faltan) {
      const i = rs.findIndex((r) => r.articulo_esc.trim().length < 2);
      return irACampo(`[data-articulo-esc="${i}"]`, `Falta el artículo ESC en ${faltan} renglón(es).`);
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("datos", JSON.stringify({
      po_numero: po, fecha: fecha || null, moneda: moneda || null, notas, tipo,
      lineas: rs.map(({ key: _k, entrega, ...r }) => ({ ...r, entrega: entrega || null })),
    }));
    if (file) fd.set("file", file);
    const r = await crearPedidoPegatronAction(fd).catch(() => ({ ok: false as const, error: "No se pudo guardar. Revisa tu conexión." }));
    setBusy(false);
    if (!r.ok) return setAviso({ tone: "error", text: r.error });
    router.push(`/pedidos-pegatron/${r.id}`);
  }

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setArrastra(true); }}
        onDragLeave={() => setArrastra(false)}
        onDrop={(e) => { e.preventDefault(); setArrastra(false); void leer(e.dataTransfer.files?.[0]); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${arrastra ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-[#0f2f7a] to-[#1d5fd6] text-xs font-bold text-white">PDF</span>
        <span className="font-medium text-slate-800">{leyendo ? "Leyendo la orden de compra..." : file ? file.name : "Arrastra aquí la orden de compra de Pegatron (PDF)"}</span>
        <span className="text-xs text-slate-500">o tócalo para elegir el archivo</span>
        <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { void leer(e.target.files?.[0]); e.target.value = ""; }} />
      </label>

      {aviso && <Alert tone={aviso.tone}>{aviso.text}</Alert>}
      {usada && (
        <Alert tone="error">
          Esta orden de compra ya se subió ({usada.folio}). <a className="font-semibold underline" href={`/pedidos-pegatron/${usada.id}`}>Ábrela aquí</a>.
        </Alert>
      )}

      {rs.length > 0 && (
        <>
          <Card className="space-y-2 p-4" data-campo="tipo-pegatron">
            <p className="text-sm font-semibold text-slate-800">¿En qué sección va esta orden? *</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(TIPOS_PEGATRON) as TipoPegatron[]).map((k) => {
                const act = tipo === k;
                return (
                  <button key={k} type="button" aria-pressed={act} onClick={() => setTipo(k)}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition ${act ? (k === "linea" ? "border-brand-600 bg-brand-600 text-white shadow" : "border-orange-500 bg-orange-500 text-white shadow") : "border-slate-300 bg-white text-slate-800 hover:border-brand-300"}`}>
                    <span className="block text-lg font-extrabold tracking-wide">{act ? "✓ " : ""}{TIPOS_PEGATRON[k].label.toUpperCase()}</span>
                    <span className={`block text-xs ${act ? "text-white/85" : "text-slate-500"}`}>{TIPOS_PEGATRON[k].ayuda}</span>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card className="grid gap-3 p-4 sm:grid-cols-4">
            <Field label="Orden de compra (P/O) *"><Input value={po} onChange={(e) => setPo(e.target.value)} className="font-mono" /></Field>
            <Field label="Fecha"><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
            <Field label="Moneda">
              <Select value={moneda} onChange={(e) => setMoneda(e.target.value as "" | "USD" | "MXN")}>
                <option value="">Sin dato</option><option value="USD">USD</option><option value="MXN">MXN</option>
              </Select>
            </Field>
            <Field label="Cliente"><Input value="Pegatron" readOnly className="bg-slate-50" /></Field>
          </Card>

          <div className="space-y-3">
            {rs.map((r, i) => (
              <Card key={r.key} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Renglón {r.item || i + 1}{r.numero_parte ? ` · Parte ${r.numero_parte}` : ""}</p>
                  </div>
                  {rs.length > 1 && <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => setRs((a) => a.filter((_, j) => j !== i))}>Quitar</button>}
                </div>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                  <Field label="Descripción (Pegatron) *"><Input value={r.descripcion} onChange={(e) => set(i, "descripcion", e.target.value)} /></Field>
                  <Field label="Cantidad (QTY) *"><Input value={r.cantidad} onChange={(e) => set(i, "cantidad", e.target.value)} inputMode="decimal" /></Field>
                  <Field label="Unidad"><Input value={r.unidad} onChange={(e) => set(i, "unidad", e.target.value)} /></Field>
                  <Field label="Entrega"><Input type="date" value={r.entrega} onChange={(e) => set(i, "entrega", e.target.value)} /></Field>
                </div>
                <div className={`rounded-lg border p-3 ${r.articulo_esc.trim().length >= 2 ? "border-green-200 bg-green-50/60" : "border-amber-300 bg-amber-50"}`}>
                  <Field label="Nombre / artículo ESC * (como lo conocemos nosotros)">
                    <Input data-articulo-esc={i} list="catalogo-esc" value={r.articulo_esc} onChange={(e) => set(i, "articulo_esc", e.target.value)} placeholder={tipo === "linea" ? "Escribe la clave o el nombre: ESC-..." : "Ej. Rollo de papel wiper para cuarto limpio 10 m"} maxLength={200} />
                  </Field>
                </div>
              </Card>
            ))}
          </div>

          <datalist id="catalogo-esc">
            {catalogo.map((c) => <option key={c.clave} value={`${c.clave} · ${c.nombre}`.slice(0, 200)} />)}
          </datalist>
          {tipo === "linea" && <p className="text-xs text-slate-500">En las de línea elige el artículo de la lista (con su clave ESC-): así compras lo suma en su planeación.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setRs((a) => [...a, nuevo()])}>+ Agregar renglón</Button>
            <span className={`text-sm ${faltan ? "text-amber-700" : "text-green-700"}`}>{faltan ? `Falta el artículo ESC en ${faltan} renglón(es)` : "Todos los renglones tienen artículo ESC"}</span>
          </div>
          <Field label="Notas para compras (opcional)">
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </Field>
          <Button loading={busy} disabled={!!usada} onClick={guardar}>Guardar y mandar a compras</Button>
        </>
      )}
    </div>
  );
}
