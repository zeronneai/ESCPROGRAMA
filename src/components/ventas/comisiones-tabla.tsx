"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { comisionesVentaAction, revisarComisionAction } from "@/actions/ventas";
import { toast } from "@/components/feedback-global";
import { Button, Card, Input, StatCard } from "@/components/ui";
import type { ComFactura, ComVendedor, ModoComisiones } from "@/lib/comisiones";
import { ComisionEditor, comisionDe, filaDe, payloadDe, type CampoCom, type FilaCom } from "@/components/ventas/comision-editor";
import { fmtMonedas2 as fmtMonedas, money, money2, porMoneda } from "@/lib/ventas";

const fecha = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "");

function Estado({ f }: { f: ComFactura }) {
  if (f.revisada) return <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">✓ Revisada</span>;
  if (f.faltan && f.pagada) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Pendiente: falta en {f.faltan}</span>;
  if (f.faltan) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Falta en {f.faltan} (aún no pagada)</span>;
  if (f.pagada) return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Por revisar</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Por cobrar</span>;
}

/** Una factura con sus articulos: el vendedor llena lo que le toca; la jefa corrige y revisa. */
function FacturaComision({ f, modo }: { f: ComFactura; modo: "vendedor" | "jefa" }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const ini = f.lineas.map((l) => filaDe(l));
  const [filas, setFilas] = useState<FilaCom[]>(ini);
  const jefa = modo === "jefa";
  // Vendedor: si ya la reviso la jefa, no; si esta pagada, solo lo que falta.
  const puede = (i: number, k: CampoCom) => jefa || (!f.revisada && (!f.pagada || ini[i][k] === ""));
  const editable = f.lineas.some((_, i) => puede(i, "imp") || puede(i, "pct") || puede(i, "env"));
  const cambio = filas.some((x, i) => x.imp !== ini[i].imp || x.pct !== ini[i].pct || x.env !== ini[i].env);
  const total = filas.reduce((a, x) => a + (comisionDe(x) ?? 0), 0) * (1 - f.descuento / 100);
  const guardar = () =>
    start(async () => {
      const r = await comisionesVentaAction(f.id, filas.map(payloadDe));
      if (!r.ok) return toast(r.error, "error");
      toast(`Comisión de ${f.factura ?? "la venta"} guardada`, "success");
      router.refresh();
    });
  const revisar = (si: boolean) =>
    start(async () => {
      const r = await revisarComisionAction(f.id, si);
      if (!r.ok) return toast(r.error, "error");
      toast(si ? `${f.factura ?? "Venta"} revisada` : "Se quitó la revisión", "success");
      router.refresh();
    });

  return (
    <div className={`rounded-lg border ${f.revisada ? "border-green-300" : f.faltan && f.pagada ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
        <span>
          <Link href={`/vendedor/bitacora/venta/${f.id}`} className="font-semibold text-slate-900 hover:underline">{f.factura ? `Factura ${f.factura}` : "Venta sin folio"}</Link>
          <span className="text-slate-600"> · {f.cliente}</span>
          <span className="block text-xs text-slate-500">
            {fecha(f.fecha)}{f.monto != null ? ` · total ${money(f.monto, f.moneda)}` : ""}{f.pagada ? ` · pagada ${fecha(f.fecha_cobro)}` : " · por cobrar"}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Estado f={f} />
          <span className="font-bold tabular-nums text-slate-900">{money2(cambio ? total : f.comision, f.moneda)}</span>
        </span>
      </div>
      {f.descuento > 0 && (
        <p className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800">
          Pago identificado tarde en Conciliaciones: comisión −{f.descuento}%{f.quincena ? `, se paga en la quincena del ${fecha(f.quincena)}` : ", se paga la siguiente quincena"}.
        </p>
      )}
      <div className="p-2">
        <ComisionEditor filas={filas} setFilas={setFilas} moneda={f.moneda} puede={editable ? puede : () => false} />
      </div>
      {(editable || jefa) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
          {editable && <Button type="button" className="text-xs" onClick={guardar} loading={pend} disabled={!cambio}>Guardar comisión</Button>}
          {jefa && !f.revisada && <Button type="button" variant="secondary" className="text-xs" onClick={() => revisar(true)} disabled={pend || cambio || f.faltan > 0}>✓ Marcar revisada</Button>}
          {jefa && f.revisada && <button type="button" onClick={() => revisar(false)} disabled={pend} className="text-xs text-slate-500 hover:underline">Quitar revisión</button>}
          {jefa && !f.revisada && f.faltan > 0 && <span className="text-xs text-slate-500">Para revisarla, todos los artículos deben tener importe y %.</span>}
          {!jefa && f.pagada && !f.revisada && <span className="text-xs text-slate-500">Ya está pagada: solo puedes llenar lo que falta.</span>}
        </div>
      )}
      {!jefa && f.revisada && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Revisada por la jefa de ventas. Si algo está mal, avísale a ella.</p>}
    </div>
  );
}

/** Comisiones por vendedor y por factura. */
export function ComisionesTabla({ vendedores, modo }: { vendedores: ComVendedor[]; modo: ModoComisiones }) {
  const [buscar, setBuscar] = useState("");
  const t = buscar.trim().toLowerCase();
  const lista = useMemo(
    () =>
      vendedores
        .map((v) => ({ ...v, facturas: t ? v.facturas.filter((f) => [f.factura ?? "", f.cliente].some((x) => x.toLowerCase().includes(t))) : v.facturas }))
        .filter((v) => v.facturas.length > 0),
    [vendedores, t],
  );
  const todas = lista.flatMap((v) => v.facturas);
  const total = porMoneda(todas, (f) => f.comision);
  const pendientes = todas.filter((f) => f.pagada && f.faltan > 0).length;
  const porRevisar = todas.filter((f) => f.pagada && !f.faltan && !f.revisada).length;
  const gerente = modo === "gerente";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={gerente ? "Comisiones a pagar" : "Comisión total"} value={fmtMonedas(total)} tone="green" />
        <StatCard label="Facturas" value={todas.length} />
        {gerente ? <StatCard label="Vendedores" value={lista.length} /> : <StatCard label="Pendientes" value={pendientes} tone={pendientes ? "amber" : "default"} hint="Pagadas sin comisión completa" />}
        {modo === "jefa" ? <StatCard label="Por revisar" value={porRevisar} tone={porRevisar ? "amber" : "default"} /> : modo === "vendedor" ? <StatCard label="Revisadas" value={todas.filter((f) => f.revisada).length} tone="green" /> : null}
      </div>
      <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar factura o cliente" />
      {lista.length === 0 && <Card className="text-sm text-slate-600">No hay ventas en esta vista.</Card>}
      {lista.map((v) => {
        const tv = porMoneda(v.facturas, (f) => f.comision);
        const pv = v.facturas.filter((f) => f.pagada && f.faltan > 0).length;
        return (
          <details key={v.id} className="group rounded-xl border border-slate-200 bg-white shadow-sm" open={!!t || lista.length === 1}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-semibold text-slate-900">{v.nombre}</span>
                <span className="block text-xs text-slate-500">{v.facturas.length} factura(s){pv && !gerente ? ` · ${pv} pendiente(s)` : ""}</span>
              </span>
              <span className="text-right">
                <span className="block text-lg font-bold tabular-nums text-slate-900">{fmtMonedas(tv)}</span>
                <span className="text-xs text-brand-700 group-open:hidden">Ver facturas</span>
              </span>
            </summary>
            <div className="space-y-3 border-t border-slate-100 p-3">
              {gerente ? (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {v.facturas.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>
                        <span className="font-semibold text-slate-900">{f.factura ? `Factura ${f.factura}` : "Venta sin folio"}</span>
                        <span className="text-slate-600"> · {f.cliente}</span>
                        <span className="block text-xs text-slate-500">{f.pagada ? `Pagada ${fecha(f.fecha_cobro)}` : `Factura del ${fecha(f.fecha)}`}</span>
                        {f.descuento > 0 && <span className="block text-xs font-medium text-red-700">Identificado tarde: −{f.descuento}%{f.quincena ? `, quincena del ${fecha(f.quincena)}` : ""}</span>}
                      </span>
                      <span className="font-bold tabular-nums text-slate-900">{money2(f.comision, f.moneda)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                v.facturas.map((f) => <FacturaComision key={`${f.id}-${f.revisada}-${f.comision}-${f.faltan}`} f={f} modo={modo} />)
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
