"use client";

import { useEffect, useRef, useState } from "react";
import { clienteFacturaAction, crearSalidaAction, folioUsadoAction, ventaDesdeFacturaAction, verificarClavesAction, type ClienteFactura, type FolioUsado } from "@/actions/almacen";
import { CustomerLookup, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";
import { leerFacturaXml, type FacturaLeida } from "@/lib/factura-lector";
import { leerFacturaPdf } from "@/lib/pdf-cliente";

type Linea = { clave: string; descripcion: string; unidad: string; cantidad: string };
type Cliente = { nombre: string; razon: string; rfc: string; direccion: string; telefono: string };
type Cobro = { total: string; moneda: "MXN" | "USD"; pago: "contado" | "credito"; dias: string };
/** Lo que se leyo del archivo queda fijo; solo se escribe lo que no se pudo leer. */
type Fijo = {
  folio: boolean; fecha: boolean; nombre: boolean; razon: boolean; rfc: boolean; direccion: boolean; telefono: boolean;
  total: boolean; moneda: boolean; pago: boolean; dias: boolean; lineas: boolean; clave: boolean[]; cant: boolean[];
};
const SIN_FIJO: Fijo = { folio: false, fecha: false, nombre: false, razon: false, rfc: false, direccion: false, telefono: false, total: false, moneda: false, pago: false, dias: false, lineas: false, clave: [], cant: [] };
const FIJO_CLS = "cursor-not-allowed !bg-slate-100 !text-slate-700 focus:!ring-0";
const FALTA_CLS = "!border-amber-400 !bg-amber-50";

const leerPdf = leerFacturaPdf;

/** El XML manda (dato fiscal exacto); el PDF completa lo que el XML no trae (direccion, telefono, nombre comercial). */
function combinar(xml: FacturaLeida | null, pdf: FacturaLeida | null): FacturaLeida | null {
  if (!xml) return pdf;
  if (!pdf) return xml;
  const out = { ...pdf } as Record<string, unknown>;
  for (const [k, val] of Object.entries(xml)) if (val !== null && val !== undefined && !(Array.isArray(val) && !val.length)) out[k] = val;
  out.direccion = pdf.direccion ?? xml.direccion;
  out.avisos = xml.avisos;
  return out as unknown as FacturaLeida;
}

const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
};

/**
 * Subir factura: se lee el folio, el cliente, la cobranza y los articulos ESC-...; el usuario revisa y corrige.
 * modo "entrega": solo se manda a almacen. modo "venta" (vendedor): se registra la venta, se da de alta o
 * completa el cliente y, si hay articulos del catalogo, tambien se manda a almacen.
 */
export function FacturaForm({ modo = "entrega", today, cliente = null, almacen = true }: { modo?: "entrega" | "venta"; today?: string; cliente?: { id: string; nombre: string } | null; almacen?: boolean }) {
  const venta = modo === "venta";
  const [pdf, setPdf] = useState<File | null>(null);
  const [xml, setXml] = useState<File | null>(null);
  const leidos = useRef<{ pdf: FacturaLeida | null; xml: FacturaLeida | null }>({ pdf: null, xml: null });
  const [leyendo, setLeyendo] = useState(false);
  const [leida, setLeida] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [v, setV] = useState({ folio: "", fecha: "", cliente: "", vendedor: "", notas: "", uuid: "", comentarios: "", pedido: "" });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [catalogo, setCatalogo] = useState<Record<string, string>>({});
  const [dup, setDup] = useState<{ folio: string; usado: FolioUsado; mensaje: string } | null>(null);
  const [cli, setCli] = useState<Cliente>({ nombre: "", razon: "", rfc: "", direccion: "", telefono: "" });
  // Domicilio de entrega de la factura: se registra como sucursal del cliente.
  const [entrega, setEntrega] = useState<{ nombre: string; direccion: string; usar: boolean } | null>(null);
  const [match, setMatch] = useState<ClienteFactura | null>(null);
  const [elegido, setElegido] = useState<{ id: string; nombre: string } | null>(cliente);
  const [cambiar, setCambiar] = useState(false);
  const [cobro, setCobro] = useState<Cobro>({ total: "", moneda: "MXN", pago: "contado", dias: "" });
  const [fijo, setFijo] = useState<Fijo>(SIN_FIJO);
  const [confirmado, setConfirmado] = useState(false);
  const { run, busy, notice, setNotice, router } = useRun();
  const pdfRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  const [arrastrando, setArrastrando] = useState(false);
  // Si sueltan el archivo fuera del cuadro, que el navegador no lo abra y se pierda la captura.
  useEffect(() => {
    const no = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", no);
    window.addEventListener("drop", no);
    return () => {
      window.removeEventListener("dragover", no);
      window.removeEventListener("drop", no);
    };
  }, []);

  async function soltar(files: FileList | null) {
    setArrastrando(false);
    const list = Array.from(files ?? []);
    const esXml = (f: File) => /\.xml$/i.test(f.name) || /xml/.test(f.type);
    const esPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    const x = list.find(esXml);
    const p = list.find(esPdf);
    if (!x && !p) return setNotice({ tone: "error", text: "Suelta el PDF (o el XML) de la factura." });
    if (p) await elegir("pdf", p);
    if (x) await elegir("xml", x);
  }

  async function revisarFolio(folio: string) {
    const f = folio.trim();
    if (!f) return setDup(null);
    const r = await folioUsadoAction(f);
    setDup(r.usado && r.mensaje ? { folio: f, usado: r.usado, mensaje: r.mensaje } : null);
  }

  async function buscarCliente(c: Cliente) {
    if (!venta || !(c.rfc || c.nombre || c.razon)) return setMatch(null);
    setMatch(await clienteFacturaAction(c.rfc, c.nombre, c.razon));
  }

  async function aplicar(f: FacturaLeida, fuente: string) {
    setV((s) => ({ ...s, folio: f.folio ?? s.folio, fecha: f.fecha ?? s.fecha, cliente: f.cliente ?? s.cliente, vendedor: f.vendedor ?? s.vendedor, uuid: f.uuid ?? s.uuid }));
    const ls = f.lineas.map((l) => ({ clave: l.clave ?? "", descripcion: l.descripcion, unidad: l.unidad ?? "", cantidad: l.cantidad != null ? String(l.cantidad) : "" }));
    setLineas(ls);
    setAvisos(f.avisos.map((a) => `${fuente}: ${a}`));
    const c: Cliente = {
      nombre: f.nombreComercial ?? f.razonSocial ?? "",
      razon: f.razonSocial ?? "",
      rfc: f.rfc ?? "",
      direccion: f.direccion ?? "",
      telefono: f.telefono ?? "",
    };
    setCli(c);
    setEntrega(f.entrega ? { nombre: f.entrega.nombre ?? "", direccion: f.entrega.direccion, usar: true } : null);
    setCobro({
      total: f.total != null ? String(f.total) : "",
      moneda: f.moneda ?? "MXN",
      pago: f.pago ?? "contado",
      dias: f.diasCredito != null ? String(f.diasCredito) : f.pago === "credito" ? "30" : "",
    });
    const leidoTexto = (x: string | null | undefined) => !!(x && x.trim());
    setFijo({
      folio: leidoTexto(f.folio), fecha: leidoTexto(f.fecha),
      nombre: leidoTexto(c.nombre), razon: leidoTexto(c.razon), rfc: leidoTexto(c.rfc), direccion: leidoTexto(c.direccion), telefono: leidoTexto(c.telefono),
      total: f.total != null, moneda: !!f.moneda, pago: !!f.pago, dias: f.diasCredito != null,
      lineas: ls.length > 0, clave: ls.map((l) => !!l.clave || !!l.descripcion), cant: ls.map((l) => l.cantidad !== ""),
    });
    setConfirmado(false);
    setLeida(true);
    if (f.folio) void revisarFolio(f.folio);
    void buscarCliente(c);
    setCatalogo(await verificarClavesAction(ls.map((l) => l.clave)));
  }

  async function elegir(tipo: "pdf" | "xml", f: File | null) {
    if (tipo === "pdf") setPdf(f);
    else setXml(f);
    if (!f) return;
    setNotice(null);
    setLeyendo(true);
    try {
      const nuevo = { ...leidos.current, [tipo]: tipo === "xml" ? leerFacturaXml(await f.text()) : await leerPdf(f) };
      leidos.current = nuevo;
      const junto = combinar(nuevo.xml, nuevo.pdf);
      if (junto) await aplicar(junto, nuevo.xml ? "XML" : "PDF");
    } catch {
      setNotice({ tone: "error", text: "No pude leer ese archivo. Revisa que sea el PDF de la factura y vuelve a subirlo." });
    } finally {
      setLeyendo(false);
    }
  }

  function reiniciar() {
    leidos.current = { pdf: null, xml: null };
    setPdf(null);
    setXml(null);
    if (pdfRef.current) pdfRef.current.value = "";
    if (xmlRef.current) xmlRef.current.value = "";
    setLeida(false);
    setAvisos([]);
    setV({ folio: "", fecha: "", cliente: "", vendedor: "", notas: "", uuid: "", comentarios: "", pedido: "" });
    setLineas([]);
    setDup(null);
    setCli({ nombre: "", razon: "", rfc: "", direccion: "", telefono: "" });
    setEntrega(null);
    setMatch(null);
    setElegido(cliente);
    setCobro({ total: "", moneda: "MXN", pago: "contado", dias: "" });
    setFijo(SIN_FIJO);
    setConfirmado(false);
    setNotice(null);
  }

  const setL = (i: number, k: keyof Linea, val: string) => setLineas((x) => x.map((l, j) => (j === i ? { ...l, [k]: k === "clave" ? val.toUpperCase() : val } : l)));
  const setC = (k: keyof Cliente) => (e: React.ChangeEvent<HTMLInputElement>) => setCli((s) => ({ ...s, [k]: k === "rfc" ? e.target.value.toUpperCase() : e.target.value }));
  // Almacen desconectado (Configuracion): la venta no se manda a cargar, nada se escanea.
  const escaneables = almacen ? lineas.filter((l) => l.clave && catalogo[l.clave.toUpperCase()]) : [];
  const clienteFinal = elegido ?? match;
  const lineasOk = lineas.length > 0 && lineas.every((l) => Number(l.cantidad) > 0);
  const ventaOk = !venta || ((!!clienteFinal || !!(cli.nombre.trim() || cli.razon.trim())) && Number(cobro.total) > 0);
  const datosLineas = () => lineas.map((l) => ({ clave: l.clave || null, descripcion: l.descripcion, unidad: l.unidad || null, cantidad: Number(l.cantidad) }));

  function guardar() {
    run("s", () => {
      const fd = new FormData();
      if (pdf) fd.set("pdf", pdf);
      if (xml) fd.set("xml", xml);
      if (!venta) {
        fd.set("datos", JSON.stringify({ folio: v.folio, fecha: v.fecha, cliente: v.cliente, vendedor: v.vendedor, notas: v.notas, lineas: datosLineas() }));
        return crearSalidaAction(fd);
      }
      fd.set("datos", JSON.stringify({
        folio: v.folio, fecha: v.fecha || null, uuid: v.uuid || null, vendedor_factura: v.vendedor || null, notas_almacen: almacen ? v.notas || null : null,
        comentarios: v.comentarios || null, pedido: v.pedido || null,
        customer_id: elegido?.id ?? null, nombre: cli.nombre, razon_social: cli.razon, rfc: cli.rfc, direccion: cli.direccion, telefono: cli.telefono,
        entrega_nombre: entrega?.usar ? entrega.nombre || null : null, entrega_direccion: entrega?.usar ? entrega.direccion || null : null,
        total: Number(cobro.total), moneda: cobro.moneda, pago: cobro.pago, dias_credito: cobro.pago === "credito" ? Number(cobro.dias) || 30 : null,
        lineas: datosLineas(),
      }));
      return ventaDesdeFacturaAction(fd);
    }, (r) => {
      if (!r.ok) return;
      router.push(venta ? `/vendedor/bitacora/venta/${(r as { id: string }).id}?nueva=factura` : `/entregas/${(r as { id: string }).id}?nueva=1`);
    });
  }

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card
        className={`space-y-3 p-4 sm:p-5 transition ${arrastrando ? "ring-4 ring-brand-300 bg-brand-50" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false); }}
        onDrop={(e) => { e.preventDefault(); void soltar(e.dataTransfer.files); }}
      >
        <p className="font-semibold text-slate-900">1. Sube la factura</p>
        <p className="text-sm text-slate-600">{arrastrando ? "Suelta aquí el PDF (y el XML si lo tienes)" : "Arrastra aquí el PDF de la factura (desde el correo o la carpeta) o elígelo con el botón."}</p>
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
        {leida && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            Lo que viene en la factura no se puede cambiar.
            <button type="button" className="font-medium text-red-700 underline" onClick={reiniciar}>¿Se leyó mal? Quitar y subir otra vez</button>
          </p>
        )}
      </Card>

      {leida && (
        <>
          <Card className="space-y-3 p-4 sm:p-5">
            <p className="font-semibold text-slate-900">2. Revisa lo que se leyó</p>
            <p className="text-xs text-slate-500">Lo gris viene de la factura y no se edita. Lo amarillo no se pudo leer: escríbelo.</p>
            {avisos.map((a) => <Alert key={a} tone="error">{a}</Alert>)}
            {dup && (
              <Alert tone="error">
                <span className="font-semibold">Folio repetido.</span> {dup.mensaje}
                {dup.usado.puede_ver && dup.usado.id && <> <a href={`/entregas/${dup.usado.id}`} className="underline">Ver la entrega</a>.</>}
                {" "}Si fue un error y hay que volver a subirla, primero se cancela la anterior.
              </Alert>
            )}
            <div className={`grid gap-3 ${venta ? "sm:grid-cols-2" : "sm:grid-cols-[10rem_10rem_1fr]"}`}>
              <Field label="Folio *"><Input value={v.folio} readOnly={fijo.folio} onChange={(e) => { setV((s) => ({ ...s, folio: e.target.value.toUpperCase() })); setDup(null); }} onBlur={(e) => !fijo.folio && revisarFolio(e.target.value)} className={`font-mono ${dup ? "border-red-400 bg-red-50" : fijo.folio ? FIJO_CLS : FALTA_CLS}`} /></Field>
              <Field label="Fecha de la factura"><Input type="date" value={v.fecha} max={today} readOnly={fijo.fecha} onChange={(e) => setV((s) => ({ ...s, fecha: e.target.value }))} className={fijo.fecha ? FIJO_CLS : FALTA_CLS} /></Field>
              {!venta && <Field label="Cliente"><Input value={v.cliente} readOnly={!!v.cliente && fijo.folio} onChange={(e) => setV((s) => ({ ...s, cliente: e.target.value }))} className={v.cliente && fijo.folio ? FIJO_CLS : ""} /></Field>}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Artículos</p>
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {lineas.map((l, i) => {
                  const enCat = l.clave && catalogo[l.clave.toUpperCase()];
                  return (
                    <li key={i} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                      <input value={l.clave} readOnly={!!fijo.clave[i]} onChange={(e) => setL(i, "clave", e.target.value)} onBlur={async () => !fijo.clave[i] && setCatalogo({ ...catalogo, ...(await verificarClavesAction([l.clave])) })} placeholder={fijo.clave[i] ? "Sin clave" : "ESC-..."} className={`w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm sm:w-44 ${fijo.clave[i] ? FIJO_CLS : FALTA_CLS}`} />
                      <div className="min-w-0 flex-1 text-sm">
                        {venta && !l.descripcion && !enCat ? (
                          <input value={l.descripcion} onChange={(e) => setL(i, "descripcion", e.target.value)} placeholder="Descripción" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                        ) : (
                          <p className="text-slate-800">{enCat || l.descripcion || "Sin descripción"}</p>
                        )}
                        {almacen && <p className={`text-xs ${enCat ? "text-green-700" : "text-amber-700"}`}>{enCat ? "En el catálogo: se escanea al cargar" : l.clave ? "Esa clave no está en el catálogo: no se escanea" : "Sin clave ESC (servicio o flete): no se escanea"}</p>}
                      </div>
                      <input value={l.cantidad} readOnly={!!fijo.cant[i]} onChange={(e) => setL(i, "cantidad", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="Cant." className={`w-20 rounded border border-slate-300 px-2 py-1.5 text-right text-sm ${fijo.cant[i] ? FIJO_CLS : FALTA_CLS}`} aria-label="Cantidad" />
                      <span className="w-24 truncate text-xs text-slate-500">{l.unidad}</span>
                      {!fijo.lineas && <button type="button" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} className="text-xs text-red-700">Quitar</button>}
                    </li>
                  );
                })}
              </ul>
              {!fijo.lineas && <button type="button" className="text-xs text-brand-700 underline" onClick={() => setLineas((x) => [...x, { clave: "", descripcion: "", unidad: "", cantidad: "" }])}>+ Agregar renglón</button>}
            </div>
            {(!venta || escaneables.length > 0) && (
              <Field label="Notas para almacén (opcional)"><Input value={v.notas} onChange={(e) => setV((s) => ({ ...s, notas: e.target.value }))} placeholder="Ej. Sale hoy en la tarde por Estafeta" /></Field>
            )}
          </Card>

          {venta && (
            <>
              <Card className="space-y-3 p-4 sm:p-5">
                <p className="font-semibold text-slate-900">3. Cliente</p>
                {elegido ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-900">{elegido.nombre}</span>
                    <span className="text-green-800">elegido a mano. Se le completan los datos que le falten.</span>
                    <button type="button" className="ml-auto text-xs text-brand-700 underline" onClick={() => setElegido(null)}>Usar el de la factura</button>
                  </div>
                ) : match ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-900">{match.nombre}{match.sucursal ? ` (sucursal de ${match.sucursal})` : ""}</span>
                    <span className="text-green-800">ya está registrado{match.rfc && match.rfc === cli.rfc ? " (mismo RFC)" : ""}. Se le completan los datos que le falten.</span>
                    <button type="button" className="ml-auto text-xs text-brand-700 underline" onClick={() => setCambiar(true)}>No es este</button>
                  </div>
                ) : (
                  <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">Cliente nuevo: se da de alta con estos datos. <button type="button" className="text-xs underline" onClick={() => setCambiar(true)}>Ya existe, elegirlo</button></p>
                )}
                {cambiar && !elegido && (
                  <div className="space-y-1">
                    <CustomerLookup placeholder="Busca al cliente (nombre, RFC o contacto)" onPick={(c) => { setElegido({ id: c.id, nombre: c.nombre }); setCambiar(false); }} />
                    <button type="button" className="text-xs text-slate-500 underline" onClick={() => setCambiar(false)}>Cerrar</button>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nombre comercial"><Input value={cli.nombre} readOnly={fijo.nombre} onChange={setC("nombre")} onBlur={() => !elegido && buscarCliente(cli)} className={`${fijo.nombre ? FIJO_CLS : ""}`} /></Field>
                  <Field label="Razón social"><Input value={cli.razon} readOnly={fijo.razon} onChange={setC("razon")} onBlur={() => !elegido && buscarCliente(cli)} className={`${fijo.razon ? FIJO_CLS : ""}`} /></Field>
                  <Field label="RFC"><Input value={cli.rfc} readOnly={fijo.rfc} onChange={setC("rfc")} onBlur={() => !elegido && buscarCliente(cli)} className={`font-mono ${fijo.rfc ? FIJO_CLS : ""}`} /></Field>
                  <Field label="Teléfono"><Input value={cli.telefono} readOnly={fijo.telefono} onChange={setC("telefono")} className={`${fijo.telefono ? FIJO_CLS : ""}`} /></Field>
                </div>
                <Field label="Dirección fiscal"><Input value={cli.direccion} readOnly={fijo.direccion} onChange={setC("direccion")} className={fijo.direccion ? FIJO_CLS : ""} /></Field>
                {entrega && (
                  <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-0.5" checked={entrega.usar} onChange={(e) => setEntrega({ ...entrega, usar: e.target.checked })} />
                      <span>
                        <span className="font-semibold text-violet-900">La factura trae otro domicilio de entrega</span>
                        <span className="block text-violet-900/80">
                          Se registra como sucursal: <b>{(elegido?.nombre ?? match?.nombre ?? (cli.nombre || cli.razon)) || "el cliente"} · {entrega.nombre || "Entrega"}</b>, y la venta queda en esa sucursal. Si ya existe, se usa la misma.
                        </span>
                      </span>
                    </label>
                    {entrega.usar && (
                      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                        <Field label="Nombre de la sucursal"><Input value={entrega.nombre} onChange={(e) => setEntrega({ ...entrega, nombre: e.target.value })} maxLength={80} placeholder="Ej. Planta Zootecnia" /></Field>
                        <Field label="Domicilio de entrega"><Input value={entrega.direccion} onChange={(e) => setEntrega({ ...entrega, direccion: e.target.value })} maxLength={300} /></Field>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="space-y-3 p-4 sm:p-5">
                <p className="font-semibold text-slate-900">4. Cobranza</p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Total de la factura *"><Input value={cobro.total} readOnly={fijo.total} onChange={(e) => setCobro((s) => ({ ...s, total: e.target.value.replace(/[^\d.]/g, "") }))} inputMode="decimal" className={fijo.total ? FIJO_CLS : FALTA_CLS} /></Field>
                  <Field label="Moneda">
                    <Select value={cobro.moneda} disabled={fijo.moneda} className={fijo.moneda ? FIJO_CLS : ""} onChange={(e) => setCobro((s) => ({ ...s, moneda: e.target.value as Cobro["moneda"] }))}><option value="MXN">MXN</option><option value="USD">USD</option></Select>
                  </Field>
                  <Field label="Pago">
                    <Select value={cobro.pago} disabled={fijo.pago} className={fijo.pago ? FIJO_CLS : FALTA_CLS} onChange={(e) => setCobro((s) => ({ ...s, pago: e.target.value as Cobro["pago"], dias: e.target.value === "credito" ? s.dias || "30" : "" }))}><option value="contado">Contado</option><option value="credito">Crédito</option></Select>
                  </Field>
                  {cobro.pago === "credito" && <Field label="Días de crédito"><Input value={cobro.dias} readOnly={fijo.dias} onChange={(e) => setCobro((s) => ({ ...s, dias: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" className={fijo.dias ? FIJO_CLS : FALTA_CLS} /></Field>}
                </div>
                <p className="text-xs text-slate-500">
                  {cobro.pago === "credito" && v.fecha && Number(cobro.dias) > 0 ? `Vence el ${sumarDias(v.fecha, Number(cobro.dias))}. ` : ""}
                  Cuando te paguen, márcala como Cobrada en tus ventas.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Pedido / OC del cliente (opcional)"><Input value={v.pedido} onChange={(e) => setV((s) => ({ ...s, pedido: e.target.value }))} /></Field>
                  <Field label="Comentarios (opcional)"><Input value={v.comentarios} onChange={(e) => setV((s) => ({ ...s, comentarios: e.target.value }))} /></Field>
                </div>
              </Card>
            </>
          )}

          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800">
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>Revisé que el folio, {venta ? "el cliente, el total, " : ""}los artículos y las cantidades coinciden con la factura.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button loading={busy === "s"} disabled={!confirmado || !v.folio.trim() || !!dup || !lineasOk || !ventaOk} onClick={guardar}>
              {venta ? (escaneables.length ? "Registrar venta y mandar a almacén" : "Registrar venta") : "Mandar a almacén para cargar"}
            </Button>
            {almacen && <span className="text-sm text-slate-500">{escaneables.length} de {lineas.length} partida(s) se escanean en almacén</span>}
            <Button variant="ghost" className="!text-red-700" onClick={reiniciar}>Cancelar y subir otra</Button>
          </div>
        </>
      )}
    </div>
  );
}
