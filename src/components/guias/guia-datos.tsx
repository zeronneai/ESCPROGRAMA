"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { empaqueLabel, resumenPartidas, type Partida } from "@/lib/ops/guias";

export type GuiaDatos = {
  factura: string;
  paqueteria: string;
  servicio: string;
  urgente: boolean;
  asegurar: boolean;
  destinatario: string;
  contacto_nombre: string | null;
  telefono: string;
  correo: string | null;
  calle_numero: string;
  colonia: string | null;
  cp: string;
  ciudad: string;
  estado_geo: string;
  referencias: string | null;
  partidas: Partida[];
  conPartidas: boolean;
  resumenViejo: string;
  medidasViejas: string;
  peso_total: string;
  contenido: string | null;
  valor: string | null;
  notas: string | null;
};

/** Boton chico para copiar un dato (para pegarlo en la pagina de la paqueteria). */
function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* sin permiso de portapapeles */
        }
      }}
      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium transition ${ok ? "bg-green-100 text-green-800" : "text-slate-500 hover:bg-slate-100 hover:text-brand-700"}`}
      aria-label="Copiar"
    >
      {ok ? "Copiado" : "Copiar"}
    </button>
  );
}

function Fila({ label, valor, copiar = true, mono = false }: { label: string; valor: string | null | undefined; copiar?: boolean; mono?: boolean }) {
  if (!valor) return null;
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:w-36">{label}</span>
      <span className={`min-w-0 flex-1 break-words text-sm text-slate-900 ${mono ? "font-mono" : "font-medium"}`}>{valor}</span>
      {copiar && <Copiar texto={valor} />}
    </div>
  );
}

function Seccion({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-700">{titulo}</h2>
        {extra}
      </div>
      {children}
    </Card>
  );
}

/** Datos del envio por secciones: envio, destinatario, direccion y paquete. */
export function GuiaDatosView({ d }: { d: GuiaDatos }) {
  const direccion = [d.calle_numero, d.colonia && `Col. ${d.colonia}`, `C.P. ${d.cp}`, `${d.ciudad}, ${d.estado_geo}`].filter(Boolean).join(", ");
  const piezas = d.conPartidas ? resumenPartidas(d.partidas) : d.resumenViejo;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Seccion
        titulo="Envío"
        extra={
          <div className="flex gap-1">
            {d.urgente && <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">URGENTE</span>}
            {d.asegurar && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">ASEGURAR</span>}
          </div>
        }
      >
        <Fila label="Factura" valor={d.factura} mono />
        <Fila label="Paquetería" valor={d.paqueteria} copiar={false} />
        <Fila label="Servicio" valor={d.servicio} copiar={false} />
        <Fila label="Valor declarado" valor={d.valor} />
        <Fila label="Contenido" valor={d.contenido} />
      </Seccion>

      <Seccion titulo="Destinatario">
        <Fila label="Persona o negocio" valor={d.destinatario} />
        <Fila label="Recibe" valor={d.contacto_nombre} />
        <Fila label="Teléfono" valor={d.telefono} mono />
        <Fila label="Correo" valor={d.correo} />
      </Seccion>

      <Seccion titulo="Dirección" extra={<Copiar texto={direccion} />}>
        <Fila label="Calle y número" valor={d.calle_numero} />
        <Fila label="Colonia" valor={d.colonia} />
        <Fila label="Código postal" valor={d.cp} mono />
        <Fila label="Ciudad" valor={d.ciudad} />
        <Fila label="Estado" valor={d.estado_geo} />
        <Fila label="Referencias" valor={d.referencias} copiar={false} />
      </Seccion>

      <Seccion titulo="Paquete" extra={<span className="text-sm font-semibold text-slate-900">{piezas} · {d.peso_total} kg</span>}>
        {d.conPartidas ? (
          <div className="space-y-2 pt-1">
            {d.partidas.map((p, i) => {
              const medidas = p.largo_cm && p.ancho_cm && p.alto_cm ? `${p.largo_cm} × ${p.ancho_cm} × ${p.alto_cm} cm` : null;
              return (
                <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      <span className="mr-2 text-slate-400">{i + 1}.</span>
                      {empaqueLabel(p.empaque, p.cantidad)}
                    </span>
                    <span className="text-sm text-slate-700">
                      {p.peso_kg} kg c/u{p.cantidad > 1 ? ` · ${Math.round(p.cantidad * p.peso_kg * 100) / 100} kg` : ""}
                    </span>
                  </div>
                  <div className="mt-1 grid gap-x-4 text-sm text-slate-700 sm:grid-cols-2">
                    <span><span className="text-xs text-slate-500">Medidas: </span>{medidas ?? <span className="text-amber-700">sin medidas</span>}</span>
                    {p.descripcion && <span><span className="text-xs text-slate-500">Lleva: </span>{p.descripcion}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <Fila label="Piezas" valor={d.resumenViejo} copiar={false} />
            <Fila label="Medidas" valor={d.medidasViejas} />
          </>
        )}
      </Seccion>

      {d.notas && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Notas del vendedor</p>
          <p className="mt-1 whitespace-pre-line text-sm text-amber-950">{d.notas}</p>
        </div>
      )}
    </div>
  );
}
