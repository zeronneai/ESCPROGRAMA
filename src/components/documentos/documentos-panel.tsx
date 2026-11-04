"use client";

import { useMemo, useRef, useState } from "react";
import { bajaDocumentoAction, editarDocumentoAction, subirDocumentoAction } from "@/actions/documentos";
import { Icon } from "@/components/icons";
import { areaCls, Chip, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, EmptyState, Field, Input, Select } from "@/components/ui";
import { CATEGORIAS_DOC, pesoArchivo, type DocumentoRow } from "@/lib/documentos";

const fecha = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Modo = { tipo: "nuevo" } | { tipo: "version"; doc: DocumentoRow } | { tipo: "editar"; doc: DocumentoRow } | { tipo: "baja"; doc: DocumentoRow } | null;

/** Base de documentos: todos consultan; el Coordinador ISO sube, versiona y da de baja. */
export function DocumentosPanel({ docs, iso, today }: { docs: DocumentoRow[]; iso: boolean; today: string }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [historial, setHistorial] = useState(false);
  const [modo, setModo] = useState<Modo>(null);
  const { notice, setNotice, router } = useRun();

  const vigentes = docs.filter((d) => d.vigente);
  const lista = useMemo(
    () =>
      docs
        .filter((d) => (historial ? !d.vigente : d.vigente))
        .filter((d) => !cat || d.categoria === cat)
        .filter((d) => !q.trim() || norm([d.codigo, d.titulo, d.descripcion, d.categoria].filter(Boolean).join(" ")).includes(norm(q.trim()))),
    [docs, historial, cat, q],
  );
  const grupos = CATEGORIAS_DOC.map((c) => ({ c, l: lista.filter((d) => d.categoria === c) })).filter((g) => g.l.length);
  const done = (text: string) => {
    setModo(null);
    setNotice({ tone: "success", text });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {iso && !modo && (
        <Button onClick={() => setModo({ tipo: "nuevo" })}>
          <Icon name="plus" className="h-4 w-4" /> Subir documento
        </Button>
      )}
      {iso && modo && modo.tipo !== "baja" && (
        <Card className="space-y-3 border-brand-100 p-4 sm:p-5">
          <h2 className="font-semibold text-slate-900">
            {modo.tipo === "nuevo" ? "Subir documento" : modo.tipo === "version" ? `Nueva versión de ${modo.doc.titulo}` : `Editar datos de ${modo.doc.titulo}`}
          </h2>
          {modo.tipo === "version" && <p className="text-sm text-slate-600">La versión {modo.doc.version} queda en el historial y la nueva pasa a ser la vigente.</p>}
          <DocForm
            key={modo.tipo + ("doc" in modo ? modo.doc.id : "")}
            modo={modo}
            today={today}
            onDone={done}
            onCancel={() => setModo(null)}
          />
        </Card>
      )}
      {iso && modo?.tipo === "baja" && <BajaForm doc={modo.doc} onDone={done} onCancel={() => setModo(null)} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, código o descripción" className="sm:max-w-sm" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="sm:w-48!">
          <option value="">Todas las categorías</option>
          {CATEGORIAS_DOC.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:ml-auto">
          <input type="checkbox" checked={historial} onChange={(e) => setHistorial(e.target.checked)} />
          Ver versiones anteriores y bajas ({docs.length - vigentes.length})
        </label>
      </div>

      {grupos.length === 0 ? (
        <Card className="p-0">
          <EmptyState title={docs.length === 0 ? "Aún no hay documentos" : "Sin documentos en esta vista"}>
            {docs.length === 0 && (iso ? "Sube el primero con el botón Subir documento." : "El Coordinador ISO los irá subiendo.")}
          </EmptyState>
        </Card>
      ) : (
        grupos.map((g) => (
          <Card key={g.c} className="overflow-hidden p-0">
            <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {g.c} <span className="font-normal">({g.l.length})</span>
            </h2>
            <ul className="divide-y divide-slate-100">
              {g.l.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {d.codigo && <span className="font-mono text-xs text-slate-500">{d.codigo}</span>}
                      <span>{d.titulo}</span>
                      <Chip cls="bg-slate-100 text-slate-700">Versión {d.version}</Chip>
                      {!d.vigente && <Chip cls={d.baja_at ? "bg-red-100 text-red-800" : "bg-slate-200 text-slate-700"}>{d.baja_at ? "Dado de baja" : "Versión anterior"}</Chip>}
                    </p>
                    <p className="text-xs text-slate-500">
                      Emitido el {fecha(d.fecha_emision)} · {pesoArchivo(d.tamano)}{d.autor_nombre ? ` · subió ${d.autor_nombre}` : ""}
                    </p>
                    {d.descripcion && <p className="text-xs text-slate-600">{d.descripcion}</p>}
                    {d.baja_motivo && <p className="text-xs text-red-700">Baja: {d.baja_motivo}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5 text-xs">
                    <a href={`/api/documentos/${d.id}`} target="_blank" rel="noreferrer" className="rounded-full bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">Ver PDF</a>
                    <a href={`/api/documentos/${d.id}?descargar=1`} className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">Descargar</a>
                    {iso && d.vigente && (
                      <>
                        <button type="button" onClick={() => setModo({ tipo: "version", doc: d })} className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">Nueva versión</button>
                        <button type="button" onClick={() => setModo({ tipo: "editar", doc: d })} className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">Editar datos</button>
                        <button type="button" onClick={() => setModo({ tipo: "baja", doc: d })} className="rounded-full px-3 py-1.5 text-red-700 hover:bg-red-50">Dar de baja</button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}

function DocForm({ modo, today, onDone, onCancel }: { modo: NonNullable<Modo>; today: string; onDone: (t: string) => void; onCancel: () => void }) {
  const base = "doc" in modo ? modo.doc : null;
  const nextVer = (v: string) => (/^\d+$/.test(v) ? String(Number(v) + 1).padStart(v.length, "0") : "");
  const [v, setV] = useState({
    codigo: base?.codigo ?? "",
    titulo: base?.titulo ?? "",
    categoria: base?.categoria ?? "Política",
    version: modo.tipo === "version" && base ? nextVer(base.version) : base?.version ?? "01",
    fecha_emision: modo.tipo === "editar" && base ? base.fecha_emision : today,
    descripcion: base?.descripcion ?? "",
  });
  const [file, setFile] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const { run, busy, notice } = useRun();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const conArchivo = modo.tipo !== "editar";

  function save() {
    if (modo.tipo === "editar" && base) {
      run("save", () => editarDocumentoAction(base.id, v), (r) => r.ok && onDone("Datos guardados."));
      return;
    }
    run("save", async () => {
      const fd = new FormData();
      for (const [k, val] of Object.entries(v)) fd.set(k, val);
      if (modo.tipo === "version" && base) fd.set("reemplaza", base.id);
      const f = ref.current?.files?.[0];
      if (f) fd.set("file", f);
      return subirDocumentoAction(fd);
    }, (r) => r.ok && onDone(modo.tipo === "version" ? "Nueva versión publicada." : "Documento publicado. Ya lo pueden consultar todos."));
  }

  return (
    <div className="space-y-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Código"><Input value={v.codigo} onChange={set("codigo")} placeholder="Ej. ESC-SGC-PO-001" className="font-mono uppercase" /></Field>
        <Field label="Título *"><Input value={v.titulo} onChange={set("titulo")} placeholder="Ej. Política de calidad" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Categoría *">
          <Select value={v.categoria} onChange={set("categoria")}>{CATEGORIAS_DOC.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Versión *"><Input value={v.version} onChange={set("version")} placeholder="01" /></Field>
        <Field label="Fecha de emisión *"><Input type="date" value={v.fecha_emision} onChange={set("fecha_emision")} /></Field>
      </div>
      <Field label="Descripción (opcional)">
        <textarea value={v.descripcion} onChange={set("descripcion")} rows={2} className={areaCls} placeholder="Para qué sirve o a quién aplica" />
      </Field>
      {conArchivo && (
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-3 text-sm text-slate-700 hover:bg-slate-50">
          <Icon name="download" className="h-4 w-4 rotate-180" />
          <span className="truncate">{file || "Elegir el PDF (máximo 10 MB) *"}</span>
          <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} />
        </label>
      )}
      <div className="flex gap-2">
        <Button type="button" loading={busy === "save"} disabled={(conArchivo && !file) || v.titulo.trim().length < 2} onClick={save}>
          {modo.tipo === "editar" ? "Guardar" : "Publicar"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={!!busy}>Cancelar</Button>
      </div>
    </div>
  );
}

function BajaForm({ doc, onDone, onCancel }: { doc: DocumentoRow; onDone: (t: string) => void; onCancel: () => void }) {
  const [motivo, setMotivo] = useState("");
  const { run, busy, notice } = useRun();
  return (
    <Card className="space-y-3 border-red-200 bg-red-50/40 p-4">
      <h2 className="font-semibold text-slate-900">Dar de baja: {doc.titulo}</h2>
      <p className="text-sm text-slate-600">Deja de aparecer como vigente pero queda en el historial.</p>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ej. se reemplazó por el procedimiento de compras)" />
      <div className="flex gap-2">
        <Button className="bg-red-600 hover:bg-red-700" loading={busy === "b"} disabled={motivo.trim().length < 3} onClick={() => run("b", () => bajaDocumentoAction(doc.id, false, motivo), (r) => r.ok && onDone("Documento dado de baja."))}>Dar de baja</Button>
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}
