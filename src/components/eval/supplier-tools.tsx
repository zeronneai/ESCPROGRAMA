"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { importarProveedoresAction, leerArchivoProveedoresAction } from "@/actions/evaluaciones";
import { SupplierForm } from "@/components/eval/suppliers-panel";
import { Icon } from "@/components/icons";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Select } from "@/components/ui";
import type { SupplierRow } from "@/lib/evaluaciones";
import { adivinarColumnas, CAMPOS_IMPORT, filaAProveedor, normTxt, type CampoImport, type Mapeo } from "@/lib/proveedores-import";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:max-w-2xl sm:rounded-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Boton "+ Proveedor" de la barra del comprador. */
export function AddSupplierButton() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SupplierRow | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setSaved(null);
  }, []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Agregar proveedor" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-600 px-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50 sm:px-3">
        <Icon name="truck" className="h-4 w-4" />
        <span className="hidden xl:inline">Proveedor</span>
      </button>
      {open && (
        <Modal title={saved ? "Proveedor dado de alta" : "Agregar proveedor"} onClose={close}>
          {saved ? (
            <div className="space-y-3">
              <Alert tone="success">&quot;{saved.nombre}&quot; quedó guardado en Proveedores.</Alert>
              <div className="flex gap-2">
                <Button onClick={close}>Listo</Button>
                <Button variant="secondary" onClick={() => setSaved(null)}>Agregar otro</Button>
              </div>
            </div>
          ) : (
            <SupplierForm s={null} onSaved={setSaved} onCancel={close} />
          )}
        </Modal>
      )}
    </>
  );
}

/** Importar proveedores desde Excel o CSV: se eligen las columnas y se dan de alta los que no existen. */
export function SupplierImport({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Icon name="download" className="h-4 w-4 rotate-180" /> Importar Excel o CSV
      </Button>
      {open && (
        <Modal title="Importar proveedores" onClose={close}>
          <ImportWizard onDone={() => { close(); onDone(); }} />
        </Modal>
      )}
    </>
  );
}

function ImportWizard({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState("");
  const [data, setData] = useState<{ headers: string[]; rows: string[][]; existentes: string[] } | null>(null);
  const [map, setMap] = useState<Mapeo>({});
  const [evaluar, setEvaluar] = useState(true);
  const { run, busy, notice, setNotice, router } = useRun();

  const filas = useMemo(() => {
    if (!data) return [];
    const ya = new Set(data.existentes.map(normTxt));
    const vistos = new Set<string>();
    return data.rows.map((r) => {
      const p = filaAProveedor(r, map);
      const k = p ? normTxt(p.nombre) : "";
      const estado = !p ? "sin_nombre" : ya.has(k) ? "existe" : vistos.has(k) ? "repetido" : "nuevo";
      if (p) vistos.add(k);
      return { p, estado };
    });
  }, [data, map]);
  const nuevos = filas.filter((f) => f.estado === "nuevo");

  if (!data) {
    return (
      <div className="space-y-3">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <p className="text-sm text-slate-600">
          Sube un Excel (.xlsx) o CSV con una fila de encabezados (por ejemplo: Proveedor, Contacto, Teléfono, Correo, País). No tiene que estar completo: después editas cada proveedor.
        </p>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-3 text-sm text-slate-700 hover:bg-slate-50">
          <Icon name="download" className="h-4 w-4 rotate-180" />
          <span className="truncate">{file || "Elegir archivo .xlsx o .csv"}</span>
          <input ref={ref} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} />
        </label>
        <Button
          disabled={!file}
          loading={busy === "leer"}
          onClick={() =>
            run("leer", async () => {
              const fd = new FormData();
              const f = ref.current?.files?.[0];
              if (f) fd.set("file", f);
              const r = await leerArchivoProveedoresAction(fd);
              if (r.ok) {
                setData(r);
                setMap(adivinarColumnas(r.headers));
              }
              return r;
            }, () => {})
          }
        >
          Leer archivo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div>
        <p className="text-sm font-semibold text-slate-800">1. ¿Qué columna es cada dato?</p>
        <p className="text-xs text-slate-500">Ya propusimos las columnas según los encabezados; corrige si algo no cuadra. Solo el nombre es obligatorio.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {CAMPOS_IMPORT.map((c) => (
          <label key={c.k} className="flex items-center gap-2 text-sm">
            <span className="w-36 shrink-0 text-slate-700">{c.label}</span>
            <Select
              value={map[c.k] === undefined ? "" : String(map[c.k])}
              onChange={(e) => setMap((m) => ({ ...m, [c.k as CampoImport]: e.target.value === "" ? undefined : Number(e.target.value) }))}
            >
              <option value="">(no viene)</option>
              {data.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
            </Select>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={evaluar} onChange={(e) => setEvaluar(e.target.checked)} /> Incluirlos en la evaluación de proveedores
      </label>
      <div>
        <p className="text-sm font-semibold text-slate-800">2. Revisa</p>
        <p className="text-xs text-slate-500">
          {nuevos.length} nuevo(s) · {filas.filter((f) => f.estado === "existe").length} ya existen · {filas.filter((f) => f.estado === "repetido").length} repetidos en el archivo · {filas.filter((f) => f.estado === "sin_nombre").length} sin nombre (se omiten)
        </p>
      </div>
      <Card className="max-h-64 overflow-auto p-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
            <tr><th className="px-2 py-1.5">Nombre</th><th className="px-2 py-1.5">Contacto</th><th className="px-2 py-1.5">Teléfono / correo</th><th className="px-2 py-1.5">País</th><th className="px-2 py-1.5" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.slice(0, 100).map((f, i) => (
              <tr key={i} className={f.estado === "nuevo" ? "" : "text-slate-400"}>
                <td className="px-2 py-1.5">{f.p?.nombre ?? "(sin nombre)"}</td>
                <td className="px-2 py-1.5">{f.p?.contacto_nombre}</td>
                <td className="px-2 py-1.5">{[f.p?.telefono, f.p?.correo].filter(Boolean).join(" · ")}</td>
                <td className="px-2 py-1.5">{f.p?.pais}</td>
                <td className="px-2 py-1.5 text-right">{f.estado === "nuevo" ? "Nuevo" : f.estado === "existe" ? "Ya existe" : f.estado === "repetido" ? "Repetido" : "Se omite"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {filas.length > 100 && <p className="text-xs text-slate-500">Se muestran los primeros 100 de {filas.length}.</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!nuevos.length}
          loading={busy === "imp"}
          onClick={() =>
            run("imp", () => importarProveedoresAction(nuevos.map((f) => f.p!), evaluar), (r) => {
              if (!r.ok) return;
              const x = r as unknown as { creados: number; omitidos: number };
              setNotice({ tone: "success", text: `Listo: ${x.creados} proveedor(es) dados de alta.` });
              router.refresh();
              setTimeout(onDone, 900);
            })
          }
        >
          Dar de alta {nuevos.length} proveedor(es)
        </Button>
        <Button variant="ghost" onClick={() => setData(null)}>Elegir otro archivo</Button>
      </div>
    </div>
  );
}
