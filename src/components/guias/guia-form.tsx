"use client";

import { useRef, useState } from "react";
import { datosFacturaGuiaAction, proveedorGuiaAction, saveGuiaAction, subirOcGuiaAction } from "@/actions/guias";
import { areaCls, CustomerLookup, useRun } from "@/components/ops-ui";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { DESTINO_ESC, PAQUETERIAS, RECOLECCION_MODOS, SERVICIOS, guiaTitle, partirDireccion, resumenPartidas, type GuiaInput } from "@/lib/ops/guias";
import { contenidoOc, domicilioOc, leerOcMicrosip } from "@/lib/oc-microsip";
import { textosPdf } from "@/lib/pegatron-po";
import { ESTADOS_MX } from "@/lib/validation/customer";

type F = Record<Exclude<keyof GuiaInput, "partidas">, string | boolean | null>;
const EMPTY: F = {
  factura: "", destinatario: "", paqueteria: "", paqueteria_otra: "", servicio: "estandar", customer_id: null, contacto_nombre: "",
  telefono: "", correo: "", calle_numero: "", colonia: "", cp: "", ciudad: "", estado_geo: "", referencias: "",
  contenido: "", valor_declarado: "", valor_moneda: "MXN", asegurar: false, urgente: false, notas: "",
  sentido: "envio", recoleccion_modo: "recoleccion", recoleccion_fecha: "", origen_nombre: "", origen_contacto: "", origen_telefono: "", origen_calle_numero: "", origen_colonia: "", origen_cp: "",
  origen_ciudad: "", origen_estado_geo: "",
};
/** Partida en el formulario (texto mientras se escribe). */
export type PartidaForm = { key: string; empaque: "bulto" | "tarima"; cantidad: string; peso_kg: string; largo_cm: string; ancho_cm: string; alto_cm: string; descripcion: string };
const nuevaPartida = (empaque: "bulto" | "tarima" = "bulto"): PartidaForm => ({
  key: Math.random().toString(36).slice(2), empaque, cantidad: "1", peso_kg: "", largo_cm: "", ancho_cm: "", alto_cm: "", descripcion: "",
});
const numero = (x: string) => Number(x.replace(",", "."));

export function GuiaForm({ id, initial, partidas: iniciales, facturas = [], onDone, referencia = false, contactoEsc }: {
  id: string | null; initial?: Partial<F>; partidas?: PartidaForm[]; facturas?: { folio: string; cliente: string }[]; onDone?: () => void;
  /** Compras: acepta factura u otra referencia (OC, muestra) y puede pedir recolecciones con proveedor. */ referencia?: boolean;
  /** Quien recibe en ESC en las recolecciones (compras). */ contactoEsc?: { nombre: string; telefono: string };
}) {
  const destinoEsc = { ...DESTINO_ESC, contacto_nombre: contactoEsc?.nombre ?? "", telefono: contactoEsc?.telefono ?? "" };
  // Compras casi siempre pide guias de su proveedor hacia ESC: empieza en recoleccion.
  const [v, setV] = useState<F>(() => ({ ...EMPTY, ...(referencia && !id ? { sentido: "recoleccion", ...destinoEsc } : {}), ...initial }));
  const reco = v.sentido === "recoleccion";
  const [oc, setOc] = useState<File | null>(null);
  const [ocAviso, setOcAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [leyendoOc, setLeyendoOc] = useState(false);
  async function leerOc(f: File | null | undefined) {
    if (!f) return;
    setOc(f);
    setOcAviso(null);
    if (f.type !== "application/pdf") return setOcAviso({ ok: true, texto: "OC adjunta. Como es imagen, captura los datos del proveedor a mano." });
    setLeyendoOc(true);
    try {
      const d = leerOcMicrosip(await textosPdf(f));
      const dom = domicilioOc(d, partirDireccion);
      const via = d.via?.trim() ?? "";
      const paq = PAQUETERIAS.find((p) => p !== "Otra" && via && p.toLowerCase().replace(/\s/g, "") === via.toLowerCase().replace(/\s/g, ""));
      const cont = contenidoOc(d);
      setV((x) => {
        const llena = (k: keyof F, val: string | null | undefined) => (val && !String(x[k] ?? "").trim() ? { [k]: val } : {});
        return {
          ...x,
          ...llena("factura", d.folio), ...llena("origen_nombre", d.proveedor), ...llena("origen_telefono", d.telefono),
          ...llena("origen_calle_numero", dom?.calle_numero), ...llena("origen_colonia", dom?.colonia), ...llena("origen_cp", dom?.cp),
          ...llena("origen_ciudad", dom?.ciudad), ...llena("origen_estado_geo", dom?.estado_geo), ...llena("contenido", cont),
          ...(x.paqueteria || !via ? {} : paq ? { paqueteria: paq } : { paqueteria: "Otra", paqueteria_otra: via }),
          ...(String(x.valor_declarado ?? "").trim() || !d.subtotal ? {} : { valor_declarado: String(d.subtotal), valor_moneda: d.moneda }),
        };
      });
      // Contacto y telefono del catalogo de proveedores (la OC no los trae).
      const cat = d.proveedor ? await proveedorGuiaAction(d.proveedor).catch(() => null) : null;
      if (cat) setV((x) => ({
        ...x,
        ...(cat.contacto && !String(x.origen_contacto ?? "").trim() ? { origen_contacto: cat.contacto } : {}),
        ...(cat.telefono && !String(x.origen_telefono ?? "").trim() ? { origen_telefono: cat.telefono } : {}),
      }));
      const tel = d.telefono || cat?.telefono;
      setOcAviso(d.proveedor
        ? { ok: true, texto: `Leímos la OC ${d.folio ?? ""} de ${d.proveedor}. Revisa el domicilio${tel ? "" : " y escribe el teléfono y contacto del proveedor (no vienen en la OC ni en el catálogo)"}.` }
        : { ok: false, texto: "Adjuntamos la OC, pero no pudimos leer el proveedor. Captúralo a mano." });
    } catch {
      setOcAviso({ ok: false, texto: "Adjuntamos la OC, pero no pudimos leerla. Captura los datos a mano." });
    } finally {
      setLeyendoOc(false);
    }
  }
  const [deFactura, setDeFactura] = useState<string | null>(null);
  const buscada = useRef("");
  // La factura ya se subio como venta: se llenan los datos del cliente o de su domicilio de entrega.
  async function llenarDeFactura(folio: string) {
    const f = folio.trim();
    if (!f || f.toUpperCase() === buscada.current) return;
    buscada.current = f.toUpperCase();
    const d = await datosFacturaGuiaAction(f).catch(() => null);
    if (!d) return setDeFactura(null);
    setV((x) => {
      const llena = (k: keyof F, val: string | null) => (val && !String(x[k] ?? "").trim() ? { [k]: val } : {});
      return {
        ...x,
        ...(x.customer_id ? {} : { customer_id: d.customer_id }),
        ...llena("destinatario", d.destinatario), ...llena("correo", d.correo),
        ...llena("calle_numero", d.calle_numero), ...llena("colonia", d.colonia), ...llena("cp", d.cp), ...llena("ciudad", d.ciudad), ...llena("estado_geo", d.estado_geo),
        ...llena("contenido", d.contenido),
        // El valor y su moneda van juntos: se toman de la factura si el valor estaba vacio.
        ...(String(x.valor_declarado ?? "").trim() || !d.valor_declarado ? {} : { valor_declarado: d.valor_declarado, valor_moneda: d.valor_moneda }),
      };
    });
    setDeFactura(`${d.folio} · ${d.destinatario}${d.entrega ? " (domicilio de entrega)" : ""}`);
  }
  const [ps, setPs] = useState<PartidaForm[]>(iniciales?.length ? iniciales : [nuevaPartida()]);
  const setP = (i: number, k: keyof PartidaForm, val: string) => setPs((a) => a.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  const validas = ps.filter((p) => numero(p.cantidad) > 0);
  const totPeso = validas.reduce((a, p) => a + (numero(p.cantidad) || 0) * (numero(p.peso_kg) || 0), 0);
  const resumen = resumenPartidas(validas.map((p) => ({ empaque: p.empaque, cantidad: Math.floor(numero(p.cantidad)) || 0 })));
  const { run, busy, notice, router } = useRun();
  const set = (k: keyof F) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const s = (k: keyof F) => (v[k] ?? "") as string;
  const title = v.factura || v.destinatario || v.paqueteria
    ? guiaTitle({ factura: s("factura") || (reco ? "?" : "Factura"), destinatario: s("destinatario") || "Destinatario", paqueteria: s("paqueteria") || "Paquetería", paqueteria_otra: s("paqueteria_otra"), sentido: s("sentido"), origen_nombre: s("origen_nombre") })
    : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const datos = { ...v, partidas: ps.map(({ key: _k, ...p }) => p) } as unknown as GuiaInput;
        run("save", async () => {
          const r = await saveGuiaAction(id, datos);
          // La OC se adjunta ya que existe la guia.
          if (r.ok && reco && oc) {
            const fd = new FormData();
            fd.set("id", r.id);
            fd.set("file", oc);
            const o = await subirOcGuiaAction(fd).catch(() => ({ ok: false as const, error: "No se pudo adjuntar la OC" }));
            if (!o.ok) return { ok: false as const, error: `La guía se pidió, pero no se adjuntó la OC: ${o.error}` };
          }
          return r;
        }, (r) => {
          if (onDone) {
            onDone();
            router.refresh();
          } else router.push(`/guias/${r.ok ? r.id : ""}`);
        });
      }}
    >
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {title && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">Título: {title}</p>}

      {referencia && (
        <div className="space-y-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white text-sm shadow-sm">
            {([["recoleccion", "Recolección con proveedor (OC)"], ["envio", "Envío a un cliente"]] as const).map(([k, l]) => (
              <button key={k} type="button"
                onClick={() => setV((x) => ({ ...x, sentido: k, ...(k === "recoleccion" && !x.destinatario ? destinoEsc : {}) }))}
                className={`px-4 py-2 font-medium ${v.sentido === k ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>{l}</button>
            ))}
          </div>
          {reco && (
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void leerOc(e.dataTransfer.files?.[0]); }}
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/50 px-4 py-6 text-center hover:bg-brand-50"
            >
              <span className="font-medium text-slate-800">{leyendoOc ? "Leyendo la OC..." : oc ? `OC: ${oc.name}` : "Arrastra aquí la orden de compra (PDF de Microsip)"}</span>
              <span className="text-xs text-slate-500">Se llenan el folio, el proveedor y su domicilio, la vía de embarque y el contenido. La OC le llega a Marketplaces.</span>
              <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => { void leerOc(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
          {ocAviso && <p className={`rounded-md border px-3 py-2 text-sm ${ocAviso.ok ? "border-green-200 bg-green-50 text-green-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{ocAviso.texto}</p>}
        </div>
      )}

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <Field label={reco ? "Orden de compra (folio) *" : referencia ? "Factura o referencia *" : "Factura *"}>
          <Input value={s("factura")} onChange={(e) => { set("factura")(e); if (facturas.some((x) => x.folio.toUpperCase() === e.target.value.trim().toUpperCase())) void llenarDeFactura(e.target.value); }}
            onBlur={(e) => void llenarDeFactura(e.target.value)} placeholder={reco ? "Ej. 700" : referencia ? "Ej. F11341, OC-0123 o Muestra proveedor" : "Ej. F11341"} list="facturas-guia" autoComplete="off" />
          <datalist id="facturas-guia">{facturas.map((x) => <option key={x.folio} value={x.folio}>{x.cliente}</option>)}</datalist>
        </Field>
        <Field label="Paquetería *">
          <Select value={s("paqueteria")} onChange={set("paqueteria")}>
            <option value="">Elige</option>
            {PAQUETERIAS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        {v.paqueteria === "Otra" ? (
          <Field label="¿Cuál? *"><Input value={s("paqueteria_otra")} onChange={set("paqueteria_otra")} /></Field>
        ) : (
          <Field label="Servicio">
            <Select value={s("servicio")} onChange={set("servicio")}>
              {Object.entries(SERVICIOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        )}
      </fieldset>

      {deFactura && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          Llenamos los datos con la factura <b>{deFactura}</b>. Revisa que el domicilio y el teléfono estén completos.
        </p>
      )}
      {reco && (
        <div className="space-y-3 rounded-xl border-2 border-sky-200 bg-sky-50/50 p-4">
          <h3 className="text-sm font-semibold text-sky-900">1. Sale del proveedor (origen)</h3>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="¿Cómo sale del proveedor? *">
              <div className="flex flex-wrap gap-2">
                {(Object.entries(RECOLECCION_MODOS) as [keyof typeof RECOLECCION_MODOS, string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setV((x) => ({ ...x, recoleccion_modo: k }))}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${v.recoleccion_modo === k ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-sky-50"}`}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label={v.recoleccion_modo === "proveedor_lleva" ? "¿Qué día lo lleva? *" : "Fecha de recolección *"}>
              <Input type="date" value={s("recoleccion_fecha")} onChange={set("recoleccion_fecha")} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Proveedor *"><Input value={s("origen_nombre")} onChange={set("origen_nombre")} placeholder="Razón social del proveedor" /></Field></div>
            <Field label="Contacto en el proveedor"><Input value={s("origen_contacto")} onChange={set("origen_contacto")} autoComplete="off" /></Field>
            <Field label="Teléfono del proveedor *"><Input value={s("origen_telefono")} onChange={set("origen_telefono")} inputMode="tel" autoComplete="off" /></Field>
            <div className="sm:col-span-2"><Field label="Calle y número *"><Input value={s("origen_calle_numero")} onChange={set("origen_calle_numero")} /></Field></div>
            <Field label="Colonia"><Input value={s("origen_colonia")} onChange={set("origen_colonia")} /></Field>
            <Field label="Código postal *"><Input value={s("origen_cp")} onChange={set("origen_cp")} inputMode="numeric" maxLength={5} /></Field>
            <Field label="Ciudad *"><Input value={s("origen_ciudad")} onChange={set("origen_ciudad")} /></Field>
            <Field label="Estado *">
              <Select value={s("origen_estado_geo")} onChange={set("origen_estado_geo")}>
                <option value="">Elige</option>
                {ESTADOS_MX.map((e) => <option key={e} value={e}>{e}</option>)}
              </Select>
            </Field>
          </div>
        </div>
      )}

      <div className={reco ? "space-y-3 rounded-xl border-2 border-green-200 bg-green-50/40 p-4" : "space-y-3"}>
        <h3 className={`text-sm font-semibold ${reco ? "text-green-900" : "text-slate-800"}`}>{reco ? "2. Se entrega en (destino: ESC)" : "Destinatario"}</h3>
        {reco && <p className="text-xs text-slate-600">Ya viene el almacén de ESC; cámbialo solo si se entrega en otro lado.</p>}
        {!reco && <CustomerLookup
          onPick={(c) =>
            setV((x) => ({
              ...x,
              customer_id: c.id,
              destinatario: c.nombre,
              correo: c.contacto_correo ?? x.correo,
              ...(() => {
                const d = partirDireccion(c.direccion);
                return c.direccion
                  ? { calle_numero: d.calle_numero || c.direccion, colonia: d.colonia || x.colonia, cp: d.cp || x.cp, ciudad: d.ciudad || x.ciudad, estado_geo: d.estado_geo || c.estado_geo || x.estado_geo }
                  : { estado_geo: c.estado_geo ?? x.estado_geo };
              })(),
            }))
          }
        />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Persona o negocio *"><Input value={s("destinatario")} onChange={set("destinatario")} /></Field>
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:col-span-2">
            <p className="text-sm font-semibold text-amber-900">¿Quién recibe? <span className="font-normal text-amber-900/80">{reco ? "Quién lo recibe en ESC." : "Escríbelo tú: la persona que va a estar para recibir el paquete."}</span></p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre de quien recibe *"><Input value={s("contacto_nombre")} onChange={set("contacto_nombre")} autoComplete="off" /></Field>
              <Field label="Teléfono de quien recibe *"><Input value={s("telefono")} onChange={set("telefono")} inputMode="tel" autoComplete="off" /></Field>
            </div>
          </div>
          <Field label="Correo"><Input value={s("correo")} onChange={set("correo")} type="email" /></Field>
          <div className="sm:col-span-2"><Field label="Calle y número *"><Input value={s("calle_numero")} onChange={set("calle_numero")} /></Field></div>
          <Field label="Colonia"><Input value={s("colonia")} onChange={set("colonia")} /></Field>
          <Field label="Código postal *"><Input value={s("cp")} onChange={set("cp")} inputMode="numeric" maxLength={5} /></Field>
          <Field label="Ciudad *"><Input value={s("ciudad")} onChange={set("ciudad")} /></Field>
          <Field label="Estado *">
            <Select value={s("estado_geo")} onChange={set("estado_geo")}>
              <option value="">Elige</option>
              {ESTADOS_MX.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Referencias del domicilio"><Input value={s("referencias")} onChange={set("referencias")} placeholder="Entre calles, color de fachada, horario de recepción" /></Field></div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Paquete</h3>
        <p className="text-xs text-slate-500">Agrega una partida por cada tipo distinto: por ejemplo, una tarima de 1.20 m y otra de 1 m van en partidas separadas. El peso y las medidas son de cada pieza.</p>
        <div className="space-y-3">
          {ps.map((p, i) => (
            <div key={p.key} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">Partida {i + 1}</span>
                <div className="flex items-center gap-2">
                  <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white text-sm">
                    {(["bulto", "tarima"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => setP(i, "empaque", k)}
                        className={`px-3 py-1.5 font-medium ${p.empaque === k ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
                        {k === "bulto" ? "Bultos" : "Tarima"}
                      </button>
                    ))}
                  </div>
                  {ps.length > 1 && (
                    <button type="button" onClick={() => setPs((a) => a.filter((_, j) => j !== i))} className="rounded-md px-2 py-1 text-sm text-red-700 hover:bg-red-50">Quitar</button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label={p.empaque === "tarima" ? "Tarimas *" : "Bultos *"}><Input value={p.cantidad} onChange={(e) => setP(i, "cantidad", e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" /></Field>
                <Field label={`Peso de c/u kg *`}><Input value={p.peso_kg} onChange={(e) => setP(i, "peso_kg", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Largo cm"><Input value={p.largo_cm} onChange={(e) => setP(i, "largo_cm", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Ancho cm"><Input value={p.ancho_cm} onChange={(e) => setP(i, "ancho_cm", e.target.value)} inputMode="decimal" /></Field>
                <Field label="Alto cm"><Input value={p.alto_cm} onChange={(e) => setP(i, "alto_cm", e.target.value)} inputMode="decimal" /></Field>
              </div>
              <Field label="Qué lleva (opcional)"><Input value={p.descripcion} onChange={(e) => setP(i, "descripcion", e.target.value)} maxLength={150} placeholder={p.empaque === "tarima" ? "Ej. Tarima con 40 cajas de guantes" : "Ej. Cajas de batas ESD"} /></Field>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" disabled={ps.length >= 30} onClick={() => setPs((a) => [...a, nuevaPartida(a[a.length - 1]?.empaque ?? "bulto")])}>+ Agregar partida</Button>
          {resumen && <span className="text-sm font-medium text-slate-700">Total: {resumen}{totPeso > 0 ? ` · ${Math.round(totPeso * 100) / 100} kg` : ""}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contenido general"><Input value={s("contenido")} onChange={set("contenido")} placeholder="Ej. 10 cajas de guantes de nitrilo" /></Field>
          <Field label="Valor declarado">
            <div className="flex gap-2">
              <Input value={s("valor_declarado")} onChange={set("valor_declarado")} inputMode="decimal" className="min-w-0 flex-1" />
              <Select value={s("valor_moneda") || "MXN"} onChange={set("valor_moneda")} className="w-24! shrink-0" aria-label="Moneda del valor declarado">
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </Select>
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={!!v.asegurar} onChange={(e) => setV((x) => ({ ...x, asegurar: e.target.checked }))} /> <span>Asegurar el envío<span className="block text-xs text-slate-500">Si se pierde o llega dañado, la paquetería paga el valor declarado. Tiene costo extra.</span></span></label>
          <label className="flex items-center gap-2 font-medium text-red-700"><input type="checkbox" checked={!!v.urgente} onChange={(e) => setV((x) => ({ ...x, urgente: e.target.checked }))} /> Es urgente</label>
        </div>
        <Field label="Notas para Marketplaces">
          <textarea value={s("notas")} onChange={set("notas")} rows={2} className={areaCls} placeholder="Recolección, horario, instrucciones especiales" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "save"}>{id ? "Guardar cambios" : "Solicitar guía"}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>}
      </div>
    </form>
  );
}
