"use client";

import { useRef, useState } from "react";
import { crearSalidaAction, folioUsadoAction, verificarClavesAction, type FolioUsado } from "@/actions/almacen";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { leerFacturaTexto, leerFacturaXml, renglonesDeItems, type FacturaLeida } from "@/lib/factura-lector";

type Linea = { clave: string; descripcion: string; unidad: string; cantidad: string };

async function leerPdf(f: File): Promise<FacturaLeida> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    lines.push(...renglonesDeItems(tc.items as { str: string; transform: number[] }[]));
  }
  return leerFacturaTexto(lines);
}

/** Subir factura: se lee el folio y los articulos ESC-...; el usuario revisa y corrige antes de guardar. */
export function FacturaForm() {
  const [pdf, setPdf] = useState<File | null>(null);
  const [xml, setXml] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [leida, setLeida] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [v, setV] = useState({ folio: "", fecha: "", cliente: "", vendedor: "", notas: "" });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [catalogo, setCatalogo] = useState<Record<string, string>>({});
  const [dup, setDup] = useState<{ folio: string; usado: FolioUsado; mensaje: string } | null>(null);

  async function revisarFolio(folio: string) {
    const f = folio.trim();
    if (!f) return setDup(null);
    const r = await folioUsadoAction(f);
    setDup(r.usado && r.mensaje ? { folio: f, usado: r.usado, mensaje: r.mensaje } : null);
  }
  const { run, busy, notice, setNotice, router } = useRun();
  const pdfRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  async function aplicar(f: FacturaLeida, fuente: string) {
    setV((s) => ({ ...s, folio: f.folio ?? s.folio, fecha: f.fecha ?? s.fecha, cliente: f.cliente ?? s.cliente, vendedor: f.vendedor ?? s.vendedor }));
    const ls = f.lineas.map((l) => ({ clave: l.clave ?? "", descripcion: l.descripcion, unidad: l.unidad ?? "", cantidad: l.cantidad != null ? String(l.cantidad) : "" }));
    setLineas(ls);
    setAvisos(f.avisos.map((a) => `${fuente}: ${a}`));
    setLeida(true);
    if (f.folio) void revisarFolio(f.folio);
    setCatalogo(await verificarClavesAction(ls.map((l) => l.clave)));
  }

  async function elegir(tipo: "pdf" | "xml", f: File | null) {
    if (tipo === "pdf") setPdf(f);
    else setXml(f);
    if (!f) return;
    setNotice(null);
    setLeyendo(true);
    try {
      // El XML manda (es el dato fiscal exacto); el PDF solo si no hay XML.
      if (tipo === "xml") await aplicar(leerFacturaXml(await f.text()), "XML");
      else if (!xml) await aplicar(await leerPdf(f), "PDF");
    } catch {
      setNotice({ tone: "error", text: "No pude leer el archivo. Llena los datos a mano." });
      setLeida(true);
      if (!lineas.length) setLineas([{ clave: "", descripcion: "", unidad: "", cantidad: "" }]);
    } finally {
      setLeyendo(false);
    }
  }

  const setL = (i: number, k: keyof Linea, val: string) => setLineas((x) => x.map((l, j) => (j === i ? { ...l, [k]: k === "clave" ? val.toUpperCase() : val } : l)));
  const escaneables = lineas.filter((l) => l.clave && catalogo[l.clave.toUpperCase()]);

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card className="space-y-3 p-4 sm:p-5">
        <p className="font-semibold text-slate-900">1. Sube la factura</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-4 text-sm hover:bg-slate-50">
            <span className="font-medium text-slate-800">PDF de la factura</span>
            <span className="truncate text-slate-500">{pdf?.name ?? "Elegir archivo"}</span>
            <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void elegir("pdf", e.target.files?.[0] ?? null)} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-4 text-sm hover:bg-slate-50">
            <span className="font-medium text-slate-800">XML (opcional, más exacto)</span>
            <span className="truncate text-slate-500">{xml?.name ?? "Elegir archivo"}</span>
            <input ref={xmlRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => void elegir("xml", e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {leyendo && <p className="flex items-center gap-2 text-sm text-slate-600"><Spinner className="h-4 w-4" /> Leyendo la factura...</p>}
        {!leida && !leyendo && (
          <button type="button" className="text-xs text-brand-700 underline" onClick={() => { setLeida(true); setLineas([{ clave: "", descripcion: "", unidad: "", cantidad: "" }]); }}>
            No tengo el archivo, capturar a mano
          </button>
        )}
      </Card>

      {leida && (
        <>
          <Card className="space-y-3 p-4 sm:p-5">
            <p className="font-semibold text-slate-900">2. Revisa lo que se leyó</p>
            {avisos.map((a) => <Alert key={a} tone="error">{a}</Alert>)}
            {dup && (
              <Alert tone="error">
                <span className="font-semibold">Folio repetido.</span> {dup.mensaje}
                {dup.usado.puede_ver && <> <a href={`/entregas/${dup.usado.id}`} className="underline">Ver la entrega</a>.</>}
                {" "}Si fue un error y hay que volver a subirla, primero se cancela la anterior.
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr]">
              <Field label="Folio *"><Input value={v.folio} onChange={(e) => { setV((s) => ({ ...s, folio: e.target.value.toUpperCase() })); setDup(null); }} onBlur={(e) => revisarFolio(e.target.value)} className={`font-mono ${dup ? "border-red-400 bg-red-50" : ""}`} /></Field>
              <Field label="Fecha"><Input type="date" value={v.fecha} onChange={(e) => setV((s) => ({ ...s, fecha: e.target.value }))} /></Field>
              <Field label="Cliente"><Input value={v.cliente} onChange={(e) => setV((s) => ({ ...s, cliente: e.target.value }))} /></Field>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Artículos</p>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {lineas.map((l, i) => {
                  const enCat = l.clave && catalogo[l.clave.toUpperCase()];
                  return (
                    <li key={i} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                      <input value={l.clave} onChange={(e) => setL(i, "clave", e.target.value)} onBlur={async () => setCatalogo({ ...catalogo, ...(await verificarClavesAction([l.clave])) })} placeholder="ESC-..." className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm sm:w-44" />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-slate-800">{enCat || l.descripcion || "Sin descripción"}</p>
                        <p className={`text-xs ${enCat ? "text-green-700" : "text-amber-700"}`}>{enCat ? "En el catálogo: se escanea al cargar" : l.clave ? "Esa clave no está en el catálogo: no se escanea" : "Sin clave ESC (servicio o flete): no se escanea"}</p>
                      </div>
                      <input value={l.cantidad} onChange={(e) => setL(i, "cantidad", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="Cant." className="w-20 rounded border border-slate-300 px-2 py-1.5 text-right text-sm" aria-label="Cantidad" />
                      <span className="w-24 truncate text-xs text-slate-500">{l.unidad}</span>
                      <button type="button" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} className="text-xs text-red-700">Quitar</button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="text-xs text-brand-700 underline" onClick={() => setLineas((x) => [...x, { clave: "", descripcion: "", unidad: "", cantidad: "" }])}>+ Agregar renglón</button>
            </div>
            <Field label="Notas para almacén (opcional)"><Input value={v.notas} onChange={(e) => setV((s) => ({ ...s, notas: e.target.value }))} placeholder="Ej. Sale hoy en la tarde por Estafeta" /></Field>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              loading={busy === "s"}
              disabled={!v.folio.trim() || !!dup || !lineas.length || lineas.some((l) => !(Number(l.cantidad) > 0))}
              onClick={() =>
                run("s", () => {
                  const fd = new FormData();
                  if (pdf) fd.set("pdf", pdf);
                  if (xml) fd.set("xml", xml);
                  fd.set("datos", JSON.stringify({ ...v, lineas: lineas.map((l) => ({ clave: l.clave || null, descripcion: l.descripcion, unidad: l.unidad || null, cantidad: Number(l.cantidad) })) }));
                  return crearSalidaAction(fd);
                }, (r) => r.ok && router.push(`/entregas/${r.id}?nueva=1`))
              }
            >
              Mandar a almacén para cargar
            </Button>
            <span className="text-sm text-slate-500">{escaneables.length} de {lineas.length} partida(s) se escanean</span>
          </div>
        </>
      )}
    </div>
  );
}
