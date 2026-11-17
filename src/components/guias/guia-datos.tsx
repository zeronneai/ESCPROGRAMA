"use client";

import { useState } from "react";
import { palomearPartidaAction } from "@/actions/guias";
import { Card } from "@/components/ui";
import { empaqueLabel, resumenPartidas, type Partida } from "@/lib/ops/guias";

export type GuiaDatos = {
  id: string;
  /** Indices de las partidas que Marketplaces ya palomeo. */
  listas: number[];
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
  /** Recoleccion con proveedor: donde se recoge y la OC. */
  origen?: {
    modo: string | null; fecha: string | null; nombre: string | null; contacto: string | null; telefono: string | null; calle_numero: string | null; colonia: string | null;
    cp: string | null; ciudad: string | null; estado_geo: string | null; oc_url: string | null; oc_nombre: string | null;
  } | null;
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
export function GuiaDatosView({ d, palomear = false }: { d: GuiaDatos; palomear?: boolean }) {
  const [listas, setListas] = useState<number[]>(d.listas);
  const [errorP, setErrorP] = useState<string | null>(null);
  async function marcar(i: number, lista: boolean) {
    const antes = listas;
    setListas((x) => (lista ? [...new Set([...x, i])] : x.filter((k) => k !== i)));
    setErrorP(null);
    const r = await palomearPartidaAction(d.id, i, lista);
    if (r.ok) setListas(r.listas);
    else {
      setListas(antes);
      setErrorP(r.error);
    }
  }
  const hechas = d.partidas.filter((_, i) => listas.includes(i)).length;
  const direccion = [d.calle_numero, d.colonia && `Col. ${d.colonia}`, `C.P. ${d.cp}`, `${d.ciudad}, ${d.estado_geo}`].filter(Boolean).join(", ");
  const o = d.origen;
  const dirOrigen = o ? [o.calle_numero, o.colonia && `Col. ${o.colonia}`, o.cp && `C.P. ${o.cp}`, [o.ciudad, o.estado_geo].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";
  const piezas = d.conPartidas ? resumenPartidas(d.partidas) : d.resumenViejo;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {o && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-sky-300 bg-gradient-to-r from-sky-50 to-green-50 px-4 py-3 lg:col-span-2">
          <p className="text-sm font-semibold text-slate-900">
            {o.modo === "proveedor_lleva" ? "EL PROVEEDOR LO LLEVA A LA PAQUETERÍA" : "RECOLECCIÓN EN EL PROVEEDOR"}
            {o.fecha && <> el <span className="rounded bg-white px-1.5 py-0.5 text-sky-900 ring-1 ring-sky-300">{fechaCorta(o.fecha)}</span></>}
            : sale de <span className="text-sky-800">{o.nombre}</span> y se entrega en <span className="text-green-800">{d.destinatario}</span>
          </p>
          {o.oc_url && (
            <a href={o.oc_url} target="_blank" rel="noreferrer" className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800">Ver OC{o.oc_nombre ? ` (${o.oc_nombre})` : ""}</a>
          )}
        </div>
      )}
      {o && (
        <Seccion titulo="Sale de (origen)" extra={dirOrigen ? <Copiar texto={dirOrigen} /> : undefined}>
          <Fila label="Cómo sale" valor={o.modo === "proveedor_lleva" ? "El proveedor lo lleva a la paquetería" : o.modo ? "La paquetería lo recoge" : null} copiar={false} />
          <Fila label={o.modo === "proveedor_lleva" ? "Día que lo lleva" : "Fecha de recolección"} valor={o.fecha ? fechaCorta(o.fecha) : null} copiar={false} />
          <Fila label="Proveedor" valor={o.nombre} />
          <Fila label="Contacto" valor={o.contacto} />
          <Fila label="Teléfono" valor={o.telefono} mono />
          <Fila label="Calle y número" valor={o.calle_numero} />
          <Fila label="Colonia" valor={o.colonia} />
          <Fila label="Código postal" valor={o.cp} mono />
          <Fila label="Ciudad" valor={o.ciudad} />
          <Fila label="Estado" valor={o.estado_geo} />
        </Seccion>
      )}
      <Seccion
        titulo="Envío"
        extra={
          <div className="flex gap-1">
            {d.urgente && <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">URGENTE</span>}
            {d.asegurar && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">ASEGURAR</span>}
          </div>
        }
      >
        <Fila label={o ? "Orden de compra" : "Factura"} valor={d.factura} mono />
        <Fila label="Paquetería" valor={d.paqueteria} copiar={false} />
        <Fila label="Servicio" valor={d.servicio} copiar={false} />
        <Fila label="Valor declarado" valor={d.valor} />
        <Fila label="Contenido" valor={d.contenido} />
      </Seccion>

      <Seccion titulo={o ? "Se entrega en (destino)" : "Destinatario"}>
        <Fila label="Persona o negocio" valor={d.destinatario} />
        <Fila label="Quién recibe" valor={d.contacto_nombre} />
        <Fila label="Tel. de quien recibe" valor={d.telefono} mono />
        <Fila label="Correo" valor={d.correo} />
      </Seccion>

      <Seccion titulo={o ? "Dirección de entrega" : "Dirección"} extra={<Copiar texto={direccion} />}>
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
            {(palomear || hechas > 0) && (
              <p className={`text-xs font-medium ${hechas === d.partidas.length ? "text-green-700" : "text-slate-600"}`}>
                {hechas === d.partidas.length ? "Todas las partidas listas" : `${hechas} de ${d.partidas.length} partidas listas`}
                {palomear && hechas < d.partidas.length ? ": palomea cada una conforme la armes." : ""}
              </p>
            )}
            {errorP && <p className="text-xs font-medium text-red-700">{errorP}</p>}
            {d.partidas.map((p, i) => {
              const medidas = p.largo_cm && p.ancho_cm && p.alto_cm ? `${p.largo_cm} × ${p.ancho_cm} × ${p.alto_cm} cm` : null;
              const lista = listas.includes(i);
              return (
                <div key={i} className={`rounded-lg border p-3 transition ${lista ? "border-green-300 bg-green-50" : "border-slate-200 bg-slate-50/70"}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <label className={`flex items-center gap-2 text-sm font-semibold text-slate-900 ${palomear ? "cursor-pointer" : ""}`}>
                      {palomear ? (
                        <input type="checkbox" checked={lista} onChange={(e) => void marcar(i, e.target.checked)} className="h-5 w-5 accent-green-600" aria-label={`Partida ${i + 1} lista`} />
                      ) : lista ? (
                        <span className="text-green-700" aria-label="Lista">✓</span>
                      ) : null}
                      <span className="text-slate-400">{i + 1}.</span>
                      <span className={lista ? "text-green-900" : ""}>{empaqueLabel(p.empaque, p.cantidad)}</span>
                    </label>
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

/** "2026-11-20" -> "vie 20 nov 2026" */
function fechaCorta(f: string) {
  const d = new Date(`${f}T12:00:00`);
  return Number.isNaN(d.getTime()) ? f : d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
