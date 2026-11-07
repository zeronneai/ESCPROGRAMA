"use client";

import { useState } from "react";
import { proformaArchivoAction, quitarProformaAction } from "@/actions/pagos";
import { useRun } from "@/components/ops-ui";
import { DocProveedorDrop } from "@/components/pagos/doc-proveedor-drop";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { fmtMonto, type OcRow } from "@/lib/pagos";
import type { DocProveedor } from "@/lib/proforma-lector";

const fecha = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * Proforma de la OC: documento de referencia con el total que mando el proveedor.
 * No se paga ni se suma a lo facturado; se reemplaza o se quita cuando cambie.
 */
export function ProformaPanel({ oc, comprador }: { oc: OcRow; comprador: boolean }) {
  const [modo, setModo] = useState<null | "reemplazar" | "editar">(null);
  const [v, setV] = useState({ numero: oc.proforma_numero ?? "", fecha: oc.proforma_fecha ?? "", monto: oc.proforma_monto != null ? String(Number(oc.proforma_monto)) : "" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [actualizarOc, setActualizarOc] = useState(true);
  const { run, busy, notice, router } = useRun();
  const tiene = !!(oc.proforma_path || oc.proforma_monto || oc.proforma_numero);

  const leido = (d: DocProveedor | null, f: File, error?: string) => {
    setArchivo(f);
    setAviso(error ?? (d?.avisos.length ? d.avisos.join(" ") : null));
    if (d) setV({ numero: d.numero ?? v.numero, fecha: d.fecha ?? v.fecha, monto: d.total ? String(d.total) : v.monto });
    setModo("editar");
  };

  const guardar = () =>
    run("s", () => {
      const fd = new FormData();
      fd.set("oc", oc.id);
      fd.set("numero", v.numero);
      fd.set("fecha", v.fecha);
      fd.set("monto", v.monto);
      if (actualizarOc) fd.set("actualizar_oc", "1");
      if (archivo) fd.set("file", archivo);
      return proformaArchivoAction(fd);
    }, (r) => {
      if (!r.ok) return;
      setModo(null);
      setArchivo(null);
      router.refresh();
    });

  if (!tiene && !comprador) return null;
  return (
    <Card className="space-y-3 border-indigo-200 bg-indigo-50/40 p-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-sm">
          <p className="font-semibold text-slate-900">
            Proforma {oc.proforma_numero ?? ""} {oc.proforma_monto != null && <span className="ml-1">{fmtMonto(oc.proforma_monto, oc.moneda)}</span>}
          </p>
          <p className="text-xs text-slate-600">
            {tiene
              ? [oc.proforma_fecha && `Del ${fecha(oc.proforma_fecha)}`, "Es de referencia: no se paga ni se suma a lo facturado."].filter(Boolean).join(" · ")
              : "Si el proveedor mandó proforma con el total, agrégala aquí. Las facturas reales se agregan abajo."}
          </p>
          {oc.proforma_path && <a href={`/api/pagos/oc/${oc.id}/proforma`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">Ver proforma</a>}
        </div>
        {comprador && !modo && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" className="text-xs" onClick={() => setModo("reemplazar")}>{tiene ? "Reemplazar documento" : "Agregar proforma"}</Button>
            {tiene && <Button variant="ghost" className="text-xs" onClick={() => setModo("editar")}>Editar datos</Button>}
            {tiene && (
              <Button variant="ghost" className="text-xs text-red-700" disabled={!!busy} onClick={() => { if (window.confirm("¿Quitar la proforma de esta OC?")) run("q", () => quitarProformaAction(oc.id), () => router.refresh()); }}>
                Quitar
              </Button>
            )}
          </div>
        )}
      </div>
      {comprador && modo === "reemplazar" && (
        <div className="space-y-2">
          <DocProveedorDrop proveedores={[]} onLeido={leido} archivo={archivo} />
          <Button variant="ghost" className="text-xs" onClick={() => setModo(null)}>Cancelar</Button>
        </div>
      )}
      {comprador && modo === "editar" && (
        <div className="space-y-3">
          {archivo && <p className="text-xs text-slate-600">Documento nuevo: <span className="font-medium">{archivo.name}</span></p>}
          {aviso && <Alert tone="error">{aviso}</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Número de proforma"><Input value={v.numero} onChange={(e) => setV((s) => ({ ...s, numero: e.target.value }))} /></Field>
            <Field label="Fecha"><Input type="date" value={v.fecha} onChange={(e) => setV((s) => ({ ...s, fecha: e.target.value }))} /></Field>
            <Field label={`Total (${oc.moneda})`}><Input value={v.monto} onChange={(e) => setV((s) => ({ ...s, monto: e.target.value.replace(/[^\d.]/g, "") }))} inputMode="decimal" /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={actualizarOc} onChange={(e) => setActualizarOc(e.target.checked)} className="h-4 w-4" />
            Usar este total como el monto de la OC
          </label>
          <div className="flex gap-2">
            <Button loading={busy === "s"} onClick={guardar}>Guardar proforma</Button>
            <Button variant="ghost" onClick={() => { setModo(null); setArchivo(null); }}>Cancelar</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
