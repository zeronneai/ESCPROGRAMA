"use client";

import { useState } from "react";
import { enviarQuejaLinkAction } from "@/actions/quejas-link";
import { areaCls } from "@/components/ops-ui";
import { Alert, Button, Field, Input } from "@/components/ui";

const vacio = { cliente_nombre: "", contacto_nombre: "", contacto_medio: "", referencia: "", descripcion: "" };

export function QuejaLinkForm({ hoy }: { hoy: string }) {
  const [v, setV] = useState(vacio);
  const [trampa, setTrampa] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folio, setFolio] = useState<string | null>(null);
  const set = (k: keyof typeof vacio) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  if (folio !== null)
    return (
      <div className="py-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-green-700" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
        </div>
        <h2 className="mt-4 text-xl font-semibold text-slate-900">Recibimos su queja</h2>
        {folio && <p className="mt-1 text-slate-700">Folio <span className="font-semibold text-brand-700">{folio}</span></p>}
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-600">
          Nuestro coordinador de calidad la revisará y le contactará al teléfono o correo que nos dejó. Gracias por ayudarnos a mejorar.
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => { setV(vacio); setFolio(null); }}>Enviar otra queja</Button>
      </div>
    );

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await enviarQuejaLinkAction(v, trampa);
          if (r.ok) setFolio(r.numero);
          else setError(r.error);
        } catch {
          setError("No se pudo enviar. Revise su conexión e intente de nuevo.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <span><span className="text-slate-500">Fecha de recepción:</span> <span className="font-medium text-slate-900">{hoy}</span></span>
        <span><span className="text-slate-500">Vía de recepción:</span> <span className="font-medium text-slate-900">Link de quejas</span></span>
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Sus datos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre de la empresa *"><Input value={v.cliente_nombre} onChange={set("cliente_nombre")} autoComplete="organization" maxLength={200} required /></Field>
          <Field label="Persona de contacto *"><Input value={v.contacto_nombre} onChange={set("contacto_nombre")} autoComplete="name" maxLength={150} required /></Field>
          <Field label="Teléfono o correo *"><Input value={v.contacto_medio} onChange={set("contacto_medio")} autoComplete="email" maxLength={200} required /></Field>
          <Field label="Pedido / factura / orden de compra"><Input value={v.referencia} onChange={set("referencia")} maxLength={200} placeholder="Si lo tiene a la mano" /></Field>
        </div>
      </div>
      <Field label="Descripción del problema o queja *">
        <textarea value={v.descripcion} onChange={set("descripcion")} rows={6} maxLength={4000} required className={areaCls}
          placeholder="Qué pasó, con qué producto, cantidades, desde cuándo y qué solución espera" />
      </Field>
      {/* Campo trampa para robots: las personas no lo ven. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Sitio web<input tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} /></label>
      </div>
      <Button type="submit" loading={busy} className="w-full sm:w-auto">Enviar queja</Button>
    </form>
  );
}
