"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buscarFacturasAction, tomarPagoAction, type FacturaBuscada } from "@/actions/conciliaciones";
import { comisionesVentaAction } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { FacturaForm } from "@/components/almacen/factura-form";
import { Button } from "@/components/ui";
import { ComisionEditor, completa, filaDe, payloadDe, type FilaCom } from "@/components/ventas/comision-editor";
import { diasRestantes, foliosSugeridos, type MovConc } from "@/lib/conciliaciones";
import { money2 } from "@/lib/ventas";

const partir = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

/**
 * El vendedor dice que facturas paga este abono. Si la factura ya esta en su bitacora y no esta pagada,
 * se pide su comision aqui mismo y queda pagada con la fecha del abono. Si no la ha subido, el pago
 * queda apartado hasta que suba el PDF.
 */
export function TomarPago({ mov, onClose, today, almacen = false }: { mov: MovConc; onClose: () => void; today?: string; almacen?: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [facturas, setFacturas] = useState<(FacturaBuscada & { filas: FilaCom[] })[] | null>(null);
  const sugeridos = foliosSugeridos(mov.descripcion);
  const [subir, setSubir] = useState(false);

  const revisar = async (t = texto) => {
    const folios = partir(t);
    if (!folios.length) return toast("Escribe el folio de la factura que paga este abono", "error");
    setBuscando(true);
    const r = await buscarFacturasAction(folios);
    setBuscando(false);
    if (!r.ok) return toast(r.error, "error");
    setFacturas(r.facturas.map((f) => ({ ...f, filas: f.lineas.map(filaDe) })));
  };
  const agregar = (f: string) => {
    const t = [...new Set([...partir(texto), f])].join(", ");
    setTexto(t);
    setFacturas(null);
  };
  const porCobrar = (facturas ?? []).filter((f) => f.venta_id && !f.pagada);
  const faltaComision = porCobrar.some((f) => !f.filas.length || !f.filas.every(completa));
  const suma = (facturas ?? []).reduce((a, f) => a + (f.monto ?? 0), 0);
  const tomar = () =>
    start(async () => {
      if (!facturas) return;
      // Primero la comision de las que se van a marcar pagadas.
      for (const f of porCobrar) {
        const r = await comisionesVentaAction(f.venta_id!, f.filas.map(payloadDe));
        if (!r.ok) return toast(`${f.folio}: ${r.error}`, "error");
      }
      const r = await tomarPagoAction(mov.id, facturas.map((f) => f.folio));
      if (!r.ok) return toast(r.error, "error");
      const pagadas = r.resultado.filter((x) => x.estado === "pagada").length;
      const pendientes = r.resultado.filter((x) => x.estado === "pendiente").length;
      toast(
        [pagadas && `${pagadas} factura(s) quedaron pagadas`, pendientes && `${pendientes} quedan apartadas hasta que subas su PDF`].filter(Boolean).join(" · ") || "Pago tomado",
        "success",
      );
      onClose();
      router.refresh();
    });

  return (
    <div className="mt-2 w-full space-y-3 rounded-xl border-2 border-brand-600 bg-brand-50/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-brand-950">Identificar abono de {money2(mov.monto, mov.moneda)}: ¿qué factura(s) paga?</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">Cancelar</button>
      </div>
      {diasRestantes(mov.created_at) <= 0 && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-800">Este pago ya pasó los 7 días para identificarlo: la comisión de estas facturas baja 10% y se paga hasta la siguiente quincena.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setFacturas(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); revisar(); } }}
          placeholder="Folio(s) de factura, separados por coma"
          className="min-w-56 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          autoFocus
        />
        <Button type="button" variant="secondary" onClick={() => revisar()} loading={buscando}>Revisar</Button>
      </div>
      {sugeridos.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          En la descripción viene:
          {sugeridos.map((s) => <button key={s} type="button" onClick={() => agregar(s)} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 font-mono hover:border-brand-600">{s}</button>)}
        </p>
      )}
      <p className="text-xs text-slate-600">
        Escribe el número de factura.{" "}
        {!subir ? (
          <button type="button" onClick={() => setSubir(true)} className="font-semibold text-brand-700 underline">¿Todavía no la subes a tu bitácora? Sube su PDF aquí</button>
        ) : (
          <button type="button" onClick={() => setSubir(false)} className="text-slate-500 underline">Ocultar subir PDF</button>
        )}
      </p>
      {subir && (
        <div className="rounded-xl border border-slate-300 bg-white p-2">
          <FacturaForm
            modo="venta"
            almacen={almacen}
            today={today}
            onGuardada={(_id, folio) => {
              setSubir(false);
              const t = [...new Set([...partir(texto), folio.trim().toUpperCase()])].filter(Boolean).join(", ");
              setTexto(t);
              toast(`Factura ${folio} registrada en tu bitácora. Ahora confirma la comisión e identifica el pago.`, "success");
              void revisar(t);
            }}
          />
        </div>
      )}
      {facturas && (
        <div className="space-y-2">
          {facturas.map((f, i) => (
            <div key={f.folio} className={`rounded-lg border bg-white p-2.5 ${!f.venta_id ? "border-amber-300" : f.pagada ? "border-slate-200" : "border-green-300"}`}>
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span><b>Factura {f.folio}</b>{f.cliente ? ` · ${f.cliente}` : ""}</span>
                {f.monto != null && <span className="tabular-nums text-slate-700">{money2(f.monto, f.moneda ?? "MXN")}</span>}
              </p>
              {!f.venta_id && (
                <p className="text-xs text-amber-800">
                  Todavía no está en tu bitácora: puedes identificar el pago y queda apartado (cuando subas su PDF se liga sola y queda pagada), o{" "}
                  <button type="button" onClick={() => setSubir(true)} className="font-semibold underline">sube su PDF ahora</button>.
                </p>
              )}
              {f.venta_id && f.pagada && <p className="text-xs text-slate-500">Ya estaba marcada pagada: solo se liga este abono.</p>}
              {f.venta_id && !f.pagada && (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-green-800">Quedará pagada con fecha {new Date(`${mov.fecha}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}. Pon su comisión:</p>
                  <ComisionEditor filas={f.filas} setFilas={(filas) => setFacturas((x) => x!.map((y, j) => (j === i ? { ...y, filas } : y)))} moneda={f.moneda ?? "MXN"} />
                </div>
              )}
            </div>
          ))}
          {suma > 0 && Math.abs(suma - mov.monto) >= 1 && (
            <p className="text-xs text-amber-800">Las facturas suman {money2(suma, mov.moneda)} y el abono es de {money2(mov.monto, mov.moneda)}. Revisa que estén todas.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={tomar} loading={pend} disabled={faltaComision}>Identificar pago</Button>
            {faltaComision && <span className="text-xs text-amber-800">Falta la comisión de algún artículo.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * La jefa de ventas, la gerente o el CEO identifican un pago a nombre de un vendedor (o de alguien
 * sin usuario). Si la factura ya esta en la bitacora de ese vendedor, se marca pagada (o queda ligada
 * para que el vendedor ponga la comision).
 */
export function IdentificarPara({ mov, vendedores, onClose }: { mov: MovConc; vendedores: { id: string; nombre: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [quien, setQuien] = useState("");
  const [otro, setOtro] = useState("");
  const [texto, setTexto] = useState("");
  const sugeridos = foliosSugeridos(mov.descripcion);
  const folios = partir(texto);
  const listo = folios.length > 0 && (quien === "otro" ? otro.trim().length > 1 : !!quien);
  const guardar = () =>
    start(async () => {
      const r = await tomarPagoAction(mov.id, folios, quien === "otro" ? { para: otro } : { vendedor: quien });
      if (!r.ok) return toast(r.error, "error");
      const pag = r.resultado.filter((x) => x.estado === "pagada").length;
      const com = r.resultado.filter((x) => x.estado === "falta_comision").length;
      toast([`Pago identificado`, pag && `${pag} factura(s) pagadas`, com && `${com} esperan la comisión del vendedor`].filter(Boolean).join(" · "), "success");
      onClose();
      router.refresh();
    });
  return (
    <div className="mt-2 w-full space-y-3 rounded-xl border-2 border-slate-700 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">Identificar este abono de {money2(mov.monto, mov.moneda)} a nombre de:</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:underline">Cancelar</button>
      </div>
      {diasRestantes(mov.created_at) <= 0 && <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-800">Ya pasaron los 7 días: la comisión baja 10% y se paga la siguiente quincena.</p>}
      <div className="flex flex-wrap gap-2">
        <select value={quien} onChange={(e) => setQuien(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
          <option value="">Elige al vendedor</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          <option value="otro">Otro (sin usuario en el portal)</option>
        </select>
        {quien === "otro" && <input value={otro} onChange={(e) => setOtro(e.target.value)} maxLength={80} placeholder="Nombre del vendedor" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />}
      </div>
      <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Folio(s) de factura, separados por coma" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      {sugeridos.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          En la descripción viene:
          {sugeridos.map((x) => <button key={x} type="button" onClick={() => setTexto([...new Set([...partir(texto), x])].join(", "))} className="rounded-full border border-slate-300 bg-white px-2 py-0.5 font-mono">{x}</button>)}
        </p>
      )}
      <Button type="button" onClick={guardar} loading={pend} disabled={!listo}>Identificar pago</Button>
    </div>
  );
}
