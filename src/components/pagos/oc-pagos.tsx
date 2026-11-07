"use client";

import { useRef, useState } from "react";
import {
  archivarPagoAction, comprobanteAction, deletePagoAction, deshacerPagoAction, facturaArchivoAction, marcarPagadoAction, savePagoAction, seguimientoPagoAction,
} from "@/actions/pagos";
import { Icon } from "@/components/icons";
import { DocProveedorDrop } from "@/components/pagos/doc-proveedor-drop";
import { pagoDesdeDoc, resumenDoc, type DocProveedor } from "@/lib/proforma-lector";
import { Chip, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { CARGA, ESTADO_PAGO, fmtMonto, ordenPagos, pagoVencido, TIPO_PAGO, type PagoInput, type PagoRow } from "@/lib/pagos";

const fecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");
type Rol = "comprador" | "ceo";

/** Facturas y anticipos de una OC con las acciones del comprador y del CEO. */
export function OcPagos({ ocId, moneda, pagos, rol, today, cerrada }: { ocId: string; moneda: string; pagos: PagoRow[]; rol: Rol; today: string; cerrada: boolean }) {
  const [nuevo, setNuevo] = useState(false);
  return (
    <div className="space-y-3">
      {pagos.length === 0 && !nuevo && (
        <Card className="p-4 text-sm text-slate-600">Esta OC aún no tiene facturas ni anticipos.{rol === "comprador" && " Agrégalos cuando el proveedor los mande."}</Card>
      )}
      {ordenPagos(pagos, today).map((p) => <PagoCard key={p.id} p={p} ocId={ocId} moneda={moneda} rol={rol} today={today} />)}
      {rol === "comprador" && !cerrada && (nuevo ? (
        <Card className="space-y-3 border-brand-100 p-4">
          <p className="text-sm font-semibold text-slate-800">Agregar factura o anticipo</p>
          <PagoForm ocId={ocId} moneda={moneda} p={null} onDone={() => setNuevo(false)} />
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setNuevo(true)}><Icon name="plus" className="h-4 w-4" /> Agregar factura o anticipo</Button>
      ))}
    </div>
  );
}

function PagoForm({ ocId, moneda, p, onDone }: { ocId: string; moneda: string; p: PagoRow | null; onDone: () => void }) {
  const hecho = p?.estado === "pagado" || p?.estado === "cerrado";
  const [v, setV] = useState({
    tipo: p?.tipo ?? "factura",
    numero_factura: p?.numero_factura ?? "",
    fecha_factura: p?.fecha_factura ?? "",
    monto: p?.monto != null ? String(Number(p.monto)) : "",
    fecha_limite: p?.fecha_limite ?? "",
    notas: p?.notas ?? "",
  });
  const { run, busy, notice, router } = useRun();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leido, setLeido] = useState<{ texto: string; avisos: string[]; error?: string } | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const aplicarDoc = (d: DocProveedor | null, f: File, error?: string) => {
    setArchivo(f);
    if (!d) return setLeido({ texto: "", avisos: [], error });
    const l = pagoDesdeDoc(d);
    setV((s) => ({ ...s, ...l, fecha_limite: s.fecha_limite, monto: hecho ? s.monto : l.monto || s.monto }));
    const avisos = [...d.avisos];
    if (d.moneda && d.moneda !== moneda) avisos.push(`Ojo: el documento está en ${d.moneda} y la OC en ${moneda}.`);
    setLeido({ texto: resumenDoc(d), avisos });
  };
  return (
    <div className="space-y-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {!p && <DocProveedorDrop proveedores={[]} onLeido={aplicarDoc} archivo={archivo} />}
      {leido?.error && <Alert tone="error">{leido.error}</Alert>}
      {leido?.texto && (
        <Alert tone="success">
          <span className="font-semibold">Leí:</span> {leido.texto}. Revisa antes de guardar.
          {leido.avisos.length > 0 && <span className="mt-1 block text-amber-800">{leido.avisos.join(" ")}</span>}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Tipo"><Select value={v.tipo} onChange={set("tipo")}><option value="factura">Factura</option><option value="anticipo">Anticipo</option></Select></Field>
        <Field label={v.tipo === "anticipo" ? "Proforma o referencia" : "Número de factura"}><Input value={v.numero_factura} onChange={set("numero_factura")} placeholder="Si aún no llega, déjalo vacío" /></Field>
        <Field label={`Monto (${moneda})`}><Input value={v.monto} onChange={set("monto")} inputMode="decimal" disabled={hecho} /></Field>
        <Field label="Fecha de la factura"><Input type="date" value={v.fecha_factura} onChange={set("fecha_factura")} /></Field>
        <Field label="Fecha límite de pago"><Input type="date" value={v.fecha_limite} onChange={set("fecha_limite")} /></Field>
        <Field label="Notas"><Input value={v.notas} onChange={set("notas")} placeholder="Ej. 30% anticipo, saldo contra BL" /></Field>
      </div>
      {hecho && <p className="text-xs text-slate-500">Ya se pagó: el monto no se puede cambiar.</p>}
      <div className="flex gap-2">
        <Button
          loading={busy === "s"}
          onClick={() =>
            run("s", async () => {
              const r = await savePagoAction(p?.id ?? null, ocId, v as PagoInput);
              if (r.ok && archivo) {
                const fd = new FormData();
                fd.set("id", r.id);
                fd.set("oc", ocId);
                fd.set("file", archivo);
                const a = await facturaArchivoAction(fd);
                if (!a.ok) return { ok: false as const, error: `Se guardó, pero no se pudo adjuntar el documento: ${a.error}` };
              }
              return r;
            }, (r) => { if (r.ok) { onDone(); router.refresh(); } })
          }
        >
          Guardar
        </Button>
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </div>
  );
}

function FileBtn({ label, accept = "application/pdf,image/png,image/jpeg,image/webp", onFile, loading }: { label: string; accept?: string; onFile: (f: File) => void; loading?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="secondary" className="text-xs" loading={loading} onClick={() => ref.current?.click()}>{label}</Button>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </>
  );
}

function PagoCard({ p, ocId, moneda, rol, today }: { p: PagoRow; ocId: string; moneda: string; rol: Rol; today: string }) {
  const [edit, setEdit] = useState(false);
  const [nota, setNota] = useState(p.estado_nota ?? "");
  const [pagar, setPagar] = useState(false);
  const [pv, setPv] = useState({ fecha: today, monto: p.monto != null ? String(Number(p.monto)) : "", referencia: "", notas: "" });
  const comp = useRef<HTMLInputElement>(null);
  const [compName, setCompName] = useState("");
  const { run, busy, notice, router } = useRun();
  const st = ESTADO_PAGO[p.estado];
  const abierto = p.estado === "pendiente";
  const vencido = pagoVencido(p, today);
  const fd = (extra: Record<string, string>, file?: File | null) => {
    const f = new FormData();
    f.set("id", p.id);
    f.set("oc", ocId);
    for (const [k, val] of Object.entries(extra)) f.set(k, val);
    if (file) f.set("file", file);
    return f;
  };
  const go = (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => run(key, fn as never, ok);

  return (
    <Card className={`space-y-3 p-4 ${abierto && p.urgente ? "border-red-400 ring-2 ring-red-200" : abierto && rol === "ceo" ? "border-amber-200" : ""}`}>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {edit ? (
        <PagoForm ocId={ocId} moneda={moneda} p={p} onDone={() => setEdit(false)} />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
              {TIPO_PAGO[p.tipo]} {p.numero_factura ?? <span className="font-normal text-amber-700">(sin número todavía)</span>}
              <span className="text-base font-semibold">{fmtMonto(p.monto, moneda)}</span>
            </p>
            <p className="text-xs text-slate-500">
              {[p.fecha_factura && `Factura del ${fecha(p.fecha_factura)}`, p.fecha_limite && `Pagar antes del ${fecha(p.fecha_limite)}`, p.notas].filter(Boolean).join(" · ") || "Sin fechas"}
            </p>
            {vencido && <p className="text-xs font-semibold text-red-700">Fecha límite vencida</p>}
            {p.estado_nota && <p className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">Comentario de compras: {p.estado_nota}</p>}
            {(p.estado === "pagado" || p.estado === "cerrado") && (
              <p className="text-xs text-sky-800">
                Pagado el {fecha(p.pago_fecha)} · {fmtMonto(p.pago_monto, moneda)}{p.pago_referencia ? ` · Ref. ${p.pago_referencia}` : ""}{p.pagado_nombre ? ` · ${p.pagado_nombre}` : ""}
                {p.pago_notas ? ` · ${p.pago_notas}` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1 text-xs">
              {p.factura_path && <a href={`/api/pagos/${p.id}/archivo?tipo=factura`} target="_blank" rel="noreferrer" className="text-brand-700 underline">Ver factura</a>}
              {p.comprobante_path && rol === "ceo" && <a href={`/api/pagos/${p.id}/archivo`} target="_blank" rel="noreferrer" className="text-brand-700 underline">Ver comprobante</a>}
              {p.comprobante_path && rol === "comprador" && p.estado === "cerrado" && <a href={`/api/pagos/${p.id}/archivo?descargar=1`} className="text-brand-700 underline">Descargar comprobante otra vez</a>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
            {abierto && p.urgente && <Chip cls="bg-red-600 text-white">URGENTE</Chip>}
            <Chip cls={CARGA[p.carga].cls}>{CARGA[p.carga].label}</Chip>
            <Chip cls={st.cls}>{st.label}</Chip>
          </div>
        </div>
      )}

      {!edit && rol === "comprador" && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {p.estado === "pagado" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 p-2">
              {p.comprobante_path ? (
                <a href={`/api/pagos/${p.id}/archivo?descargar=1`} onClick={() => setTimeout(() => router.refresh(), 1500)} className="rounded-md bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800">
                  Descargar comprobante
                </a>
              ) : (
                <span className="text-xs text-sky-900">El CEO lo marcó pagado; falta que suba el comprobante.</span>
              )}
              <span className="text-xs text-slate-600">Al descargarlo pasa al historial.</span>
              <button type="button" className="ml-auto text-xs text-slate-600 underline" disabled={!!busy} onClick={() => go("arch", () => archivarPagoAction(p.id, ocId), "Pasó al historial.")}>Archivar sin descargar</button>
            </div>
          )}
          <div className="space-y-2 rounded-md bg-slate-50 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-600">Seguimiento de la carga:</span>
              {(["sin_liberar", "liberada"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!!busy}
                  onClick={() => p.carga !== c && go(`c${c}`, () => seguimientoPagoAction(p.id, ocId, { carga: c }), c === "liberada" ? "Carga marcada como liberada." : "Carga marcada sin liberar.")}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${p.carga === c ? (c === "liberada" ? "border-green-600 bg-green-600 text-white" : "border-amber-500 bg-amber-500 text-white") : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {c === "liberada" ? "Liberada" : "Sin liberar"}
                </button>
              ))}
              {abierto && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => go("urg", () => seguimientoPagoAction(p.id, ocId, { urgente: !p.urgente }), p.urgente ? "Ya no está marcado como urgente." : "Marcado URGENTE. Se avisó al CEO.")}
                  className={`ml-auto rounded-full border px-3 py-1 text-xs font-semibold ${p.urgente ? "border-red-600 bg-red-600 text-white" : "border-red-300 bg-white text-red-700 hover:bg-red-50"}`}
                >
                  {p.urgente ? "Urgente (quitar)" : "Marcar urgente"}
                </button>
              )}
            </div>
            {abierto && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Comentario para el CEO (ej. Pendiente de pago para liberación)" />
                <Button variant="secondary" className="shrink-0 text-xs" loading={busy === "nota"} disabled={!!busy || nota.trim() === (p.estado_nota ?? "")} onClick={() => go("nota", () => seguimientoPagoAction(p.id, ocId, { comentario: nota }), nota.trim() ? "Comentario guardado. Se avisó al CEO." : "Comentario borrado.")}>
                  Guardar comentario
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" className="text-xs" onClick={() => setEdit(true)}>{p.numero_factura && p.monto ? "Editar" : "Completar factura y monto"}</Button>
            <FileBtn label={p.factura_path ? "Cambiar documento" : "Adjuntar factura o proforma"} accept=".pdf,.xlsx,.xls,.docx,.doc,.png,.jpg,.jpeg,.webp" loading={busy === "fac"} onFile={(f) => go("fac", () => facturaArchivoAction(fd({}, f)), "Factura adjunta.")} />
            {abierto && (
              <Button variant="ghost" className="text-xs text-red-700" disabled={!!busy} onClick={() => { if (window.confirm("¿Borrar esta factura o anticipo?")) go("del", () => deletePagoAction(p.id, ocId), "Borrado."); }}>Borrar</Button>
            )}
          </div>
        </div>
      )}

      {rol === "ceo" && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {abierto && !pagar && (
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => setPagar(true)}>Pagar (todo o anticipo)</Button>
          )}
          {abierto && pagar && (
            <div className="space-y-3 rounded-md border border-green-200 bg-green-50/50 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Fecha del pago *"><Input type="date" value={pv.fecha} onChange={(e) => setPv((s) => ({ ...s, fecha: e.target.value }))} /></Field>
                <Field label={`Monto que pagas (${moneda})`}><Input value={pv.monto} onChange={(e) => setPv((s) => ({ ...s, monto: e.target.value }))} inputMode="decimal" /></Field>
                <Field label="Referencia"><Input value={pv.referencia} onChange={(e) => setPv((s) => ({ ...s, referencia: e.target.value }))} placeholder="SWIFT, folio" /></Field>
                <Field label="Notas"><Input value={pv.notas} onChange={(e) => setPv((s) => ({ ...s, notas: e.target.value }))} /></Field>
              </div>
              {p.monto != null && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-600">Pagar:</span>
                  {[100, 50, 30].map((pc) => (
                    <button key={pc} type="button" className="rounded-full border border-green-300 bg-white px-2.5 py-1 font-medium text-green-800 hover:bg-green-100"
                      onClick={() => setPv((s) => ({ ...s, monto: String(Math.round(Number(p.monto) * pc) / 100) }))}>
                      {pc === 100 ? "Todo" : `Anticipo ${pc}%`}
                    </button>
                  ))}
                  {(() => {
                    const pagando = Number(String(pv.monto).replace(/,/g, ""));
                    const resto = Math.round((Number(p.monto) - pagando) * 100) / 100;
                    return pagando > 0 && resto > 0.004 ? (
                      <span className="font-medium text-amber-800">Quedará un saldo de {fmtMonto(resto, moneda)} por pagar.</span>
                    ) : pagando > Number(p.monto) + 0.004 ? (
                      <span className="font-medium text-red-700">Es más que el monto pendiente.</span>
                    ) : null;
                  })()}
                </div>
              )}
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-2 text-sm text-slate-700">
                <Icon name="download" className="h-4 w-4 rotate-180" />
                <span className="truncate">{compName || "Comprobante (PDF o imagen)"}</span>
                <input ref={comp} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setCompName(e.target.files?.[0]?.name ?? "")} />
              </label>
              <div className="flex gap-2">
                <Button className="bg-green-600 hover:bg-green-700" loading={busy === "pay"} onClick={() => go("pay", async () => {
                  const r = await marcarPagadoAction(fd(pv, comp.current?.files?.[0]));
                  if (r.ok) setPagar(false);
                  return r;
                }, "Pago registrado. Se avisó a compras.")}>Guardar pago</Button>
                <Button variant="ghost" onClick={() => setPagar(false)}>Cancelar</Button>
              </div>
            </div>
          )}
          {(p.estado === "pagado" || p.estado === "cerrado") && (
            <div className="flex flex-wrap items-center gap-2">
              <FileBtn label={p.comprobante_path ? "Cambiar comprobante" : "Subir comprobante"} loading={busy === "comp"} onFile={(f) => go("comp", () => comprobanteAction(fd({}, f)), "Comprobante subido. Se avisó a compras.")} />
              {p.estado === "pagado" && (
                <Button variant="ghost" className="text-xs" disabled={!!busy} onClick={() => { if (window.confirm("¿Deshacer este pago? Regresa a Por pagar.")) go("undo", () => deshacerPagoAction(p.id, ocId), "Pago deshecho."); }}>Deshacer pago</Button>
              )}
              {p.estado === "cerrado" && <span className="text-xs text-green-700">Compras ya descargó el comprobante.</span>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
