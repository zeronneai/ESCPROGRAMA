"use client";

import { useRef, useState } from "react";
import {
  archivarPagoAction, comprobanteAction, deletePagoAction, deshacerPagoAction, facturaArchivoAction, marcarPagadoAction, pagoEstadoAction, savePagoAction,
} from "@/actions/pagos";
import { Icon } from "@/components/icons";
import { Chip, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { ESTADO_PAGO, fmtMonto, pagoVencido, TIPO_PAGO, type PagoInput, type PagoRow } from "@/lib/pagos";

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
      {pagos.map((p) => <PagoCard key={p.id} p={p} ocId={ocId} moneda={moneda} rol={rol} today={today} />)}
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
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="space-y-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
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
        <Button loading={busy === "s"} onClick={() => run("s", () => savePagoAction(p?.id ?? null, ocId, v as PagoInput), (r) => { if (r.ok) { onDone(); router.refresh(); } })}>Guardar</Button>
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
  const [espera, setEspera] = useState(false);
  const [nota, setNota] = useState(p.estado_nota ?? "");
  const [pagar, setPagar] = useState(false);
  const [pv, setPv] = useState({ fecha: today, monto: p.monto != null ? String(Number(p.monto)) : "", referencia: "", notas: "" });
  const comp = useRef<HTMLInputElement>(null);
  const [compName, setCompName] = useState("");
  const { run, busy, notice, router } = useRun();
  const st = ESTADO_PAGO[p.estado];
  const abierto = p.estado === "por_liberar" || p.estado === "en_espera" || p.estado === "liberado";
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
    <Card className={`space-y-3 p-4 ${p.estado === "liberado" && rol === "ceo" ? "border-red-300 ring-1 ring-red-200" : ""}`}>
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
            {p.estado_nota && <p className="text-xs text-amber-800">Nota de compras: {p.estado_nota}</p>}
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
          <Chip cls={st.cls}>{st.label}</Chip>
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
          {abierto && (
            <div className="flex flex-wrap items-center gap-1.5">
              {p.estado !== "liberado" && (
                <Button className="bg-red-600 text-xs hover:bg-red-700" loading={busy === "lib"} disabled={!!busy} onClick={() => go("lib", () => pagoEstadoAction(p.id, ocId, "liberado"), "Liberado. Se avisó al CEO.")}>
                  Liberar para pago
                </Button>
              )}
              {p.estado !== "en_espera" && <Button variant="secondary" className="text-xs" disabled={!!busy} onClick={() => setEspera((x) => !x)}>Poner en espera</Button>}
              {p.estado !== "por_liberar" && <Button variant="ghost" className="text-xs" disabled={!!busy} onClick={() => go("pl", () => pagoEstadoAction(p.id, ocId, "por_liberar"), "Regresó a Por liberar.")}>Regresar a por liberar</Button>}
            </div>
          )}
          {espera && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo (ej. falta el BL, mercancía incompleta)" />
              <Button className="text-xs" loading={busy === "esp"} onClick={() => go("esp", async () => { const r = await pagoEstadoAction(p.id, ocId, "en_espera", nota); if (r.ok) setEspera(false); return r; }, "Quedó en espera.")}>Guardar</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="ghost" className="text-xs" onClick={() => setEdit(true)}>{p.numero_factura && p.monto ? "Editar" : "Completar factura y monto"}</Button>
            <FileBtn label={p.factura_path ? "Cambiar PDF de factura" : "Adjuntar factura"} loading={busy === "fac"} onFile={(f) => go("fac", () => facturaArchivoAction(fd({}, f)), "Factura adjunta.")} />
            {(p.estado === "por_liberar" || p.estado === "en_espera") && (
              <Button variant="ghost" className="text-xs text-red-700" disabled={!!busy} onClick={() => { if (window.confirm("¿Borrar esta factura o anticipo?")) go("del", () => deletePagoAction(p.id, ocId), "Borrado."); }}>Borrar</Button>
            )}
          </div>
        </div>
      )}

      {rol === "ceo" && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {p.estado === "liberado" && !pagar && (
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => setPagar(true)}>Marcar como pagado</Button>
          )}
          {abierto && pagar && (
            <div className="space-y-3 rounded-md border border-green-200 bg-green-50/50 p-3">
              {p.estado !== "liberado" && <Alert tone="info">Compras aún no lo libera ({st.label.toLowerCase()}). Puedes marcarlo pagado de todos modos.</Alert>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Fecha del pago *"><Input type="date" value={pv.fecha} onChange={(e) => setPv((s) => ({ ...s, fecha: e.target.value }))} /></Field>
                <Field label={`Monto pagado (${moneda})`}><Input value={pv.monto} onChange={(e) => setPv((s) => ({ ...s, monto: e.target.value }))} inputMode="decimal" /></Field>
                <Field label="Referencia"><Input value={pv.referencia} onChange={(e) => setPv((s) => ({ ...s, referencia: e.target.value }))} placeholder="SWIFT, folio" /></Field>
                <Field label="Notas"><Input value={pv.notas} onChange={(e) => setPv((s) => ({ ...s, notas: e.target.value }))} /></Field>
              </div>
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
                }, "Marcado como pagado. Se avisó a compras.")}>Guardar pago</Button>
                <Button variant="ghost" onClick={() => setPagar(false)}>Cancelar</Button>
              </div>
            </div>
          )}
          {(p.estado === "pagado" || p.estado === "cerrado") && (
            <div className="flex flex-wrap items-center gap-2">
              <FileBtn label={p.comprobante_path ? "Cambiar comprobante" : "Subir comprobante"} loading={busy === "comp"} onFile={(f) => go("comp", () => comprobanteAction(fd({}, f)), "Comprobante subido. Se avisó a compras.")} />
              {p.estado === "pagado" && (
                <Button variant="ghost" className="text-xs" disabled={!!busy} onClick={() => { if (window.confirm("¿Deshacer este pago? Regresa a Liberado.")) go("undo", () => deshacerPagoAction(p.id, ocId), "Pago deshecho."); }}>Deshacer pago</Button>
              )}
              {p.estado === "cerrado" && <span className="text-xs text-green-700">Compras ya descargó el comprobante.</span>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
