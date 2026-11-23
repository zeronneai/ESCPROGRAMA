"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { entregarFacturasAction } from "@/actions/recepcion";
import { toast } from "@/components/feedback-global";
import { Button, Card, Input, Select } from "@/components/ui";
import { fechaCorta, FORMAS_PAGO, type FormaPago } from "@/lib/recepcion";
import { money } from "@/lib/ventas";

export interface FacturaDisponible {
  id: string;
  factura: string;
  cliente: string;
  fecha: string;
  fecha_cobro: string | null;
  monto: number;
  moneda: string;
  rechazada: boolean;
}
interface Pago {
  key: number;
  fecha: string;
  monto: string;
  forma: FormaPago;
  referencia: string;
}

const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

/** El vendedor palomea las facturas cobradas que trae y dice con que pago se cobro cada una. */
export interface EntregaPayload {
  notas: string;
  pagos: { fecha: string; monto: number; moneda: "MXN" | "USD"; forma: FormaPago; referencia: string; ventas: string[] }[];
}

/** demo: en la demostracion no se guarda en la base; se pasa la entrega a quien la simula. */
export function EntregarFacturas({ facturas, demo }: { facturas: FacturaDisponible[]; demo?: (p: EntregaPayload) => void }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [buscar, setBuscar] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [asig, setAsig] = useState<Record<string, number>>({});
  const [notas, setNotas] = useState("");
  const [sig, setSig] = useState(1);

  const porId = useMemo(() => new Map(facturas.map((f) => [f.id, f])), [facturas]);
  const visibles = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return t ? facturas.filter((f) => [f.factura, f.cliente].some((x) => x.toLowerCase().includes(t))) : facturas;
  }, [facturas, buscar]);
  const elegidas = sel.map((id) => porId.get(id)!).filter(Boolean);
  const sinPago = elegidas.filter((f) => asig[f.id] == null);
  const sumaPago = (k: number) => elegidas.filter((f) => asig[f.id] === k).reduce((a, f) => a + f.monto, 0);
  const pagosVacios = pagos.filter((p) => !elegidas.some((f) => asig[f.id] === p.key));
  const pagosIncompletos = pagos.filter((p) => !p.fecha || !(Number(p.monto) > 0));
  const listo = elegidas.length > 0 && sinPago.length === 0 && pagosVacios.length === 0 && pagosIncompletos.length === 0;

  const toggle = (id: string) =>
    setSel((s) => {
      if (s.includes(id)) {
        setAsig((a) => {
          const n = { ...a };
          delete n[id];
          return n;
        });
        return s.filter((x) => x !== id);
      }
      // Si solo hay un pago, se asigna a ese.
      if (pagos.length === 1) setAsig((a) => ({ ...a, [id]: pagos[0].key }));
      return [...s, id];
    });
  const nuevoPago = (ids: string[] = []) => {
    const k = sig;
    setSig(k + 1);
    const fs = ids.map((id) => porId.get(id)!);
    const fecha = fs.length === 1 && fs[0].fecha_cobro ? fs[0].fecha_cobro : hoy();
    setPagos((p) => [...p, { key: k, fecha, monto: fs.length ? String(fs.reduce((a, f) => a + f.monto, 0)) : "", forma: "transferencia", referencia: "" }]);
    if (ids.length) setAsig((a) => ({ ...a, ...Object.fromEntries(ids.map((id) => [id, k])) }));
    return k;
  };
  const unoPorFactura = () => {
    let k = sig;
    const nuevos: Pago[] = [];
    const as: Record<string, number> = {};
    for (const f of sinPago) {
      nuevos.push({ key: k, fecha: f.fecha_cobro ?? hoy(), monto: String(f.monto), forma: "transferencia", referencia: "" });
      as[f.id] = k;
      k += 1;
    }
    setSig(k);
    setPagos((p) => [...p, ...nuevos]);
    setAsig((a) => ({ ...a, ...as }));
  };
  const quitarPago = (k: number) => {
    setPagos((p) => p.filter((x) => x.key !== k));
    setAsig((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== k)));
  };
  const setP = (k: number, campo: keyof Pago, v: string) => setPagos((p) => p.map((x) => (x.key === k ? { ...x, [campo]: v } : x)));

  const enviar = () =>
    start(async () => {
      const payload: EntregaPayload = {
        notas,
        pagos: pagos.map((p) => ({
          fecha: p.fecha,
          monto: Number(p.monto),
          moneda: elegidas.find((f) => asig[f.id] === p.key)?.moneda === "USD" ? "USD" : "MXN",
          forma: p.forma,
          referencia: p.referencia,
          ventas: elegidas.filter((f) => asig[f.id] === p.key).map((f) => f.id),
        })),
      };
      if (demo) demo(payload);
      else {
        const r = await entregarFacturasAction(payload);
        if (!r.ok) return toast(r.error, "error");
      }
      toast(`Listo: entregaste ${elegidas.length} factura(s) a finanzas.`, "success");
      setSel([]);
      setPagos([]);
      setAsig({});
      setNotas("");
      if (!demo) router.refresh();
    });

  if (facturas.length === 0)
    return <Card className="text-sm text-slate-600">No tienes facturas cobradas pendientes de entregar.</Card>;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">1. Palomea las facturas que vas a entregar</h2>
          <span className="text-sm text-slate-500">{sel.length} de {facturas.length}</span>
        </div>
        <div className="flex gap-2">
          <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por folio o cliente" />
          <Button type="button" variant="secondary" className="shrink-0 text-xs" onClick={() => setSel((s) => [...new Set([...s, ...visibles.map((v) => v.id)])])}>Todas</Button>
        </div>
        <div className="max-h-96 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
          {visibles.map((f) => {
            const on = sel.includes(f.id);
            return (
              <label key={f.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm ${on ? "bg-green-50" : "hover:bg-slate-50"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(f.id)} className="h-5 w-5 accent-green-600" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-900">{f.factura}</span>
                  {f.rechazada && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Rechazada antes</span>}
                  <span className="block truncate text-xs text-slate-500">{f.cliente} · {fechaCorta(f.fecha)}{f.fecha_cobro ? ` · cobrada ${fechaCorta(f.fecha_cobro)}` : ""}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-700">{money(f.monto, f.moneda)}</span>
              </label>
            );
          })}
          {visibles.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">Ninguna factura coincide.</p>}
        </div>
      </Card>

      {elegidas.length > 0 && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">2. ¿Con qué pago te pagaron cada factura?</h2>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="text-xs" onClick={() => nuevoPago(pagos.length === 0 ? sel : [])}>+ Agregar pago</Button>
              {sinPago.length > 0 && <Button type="button" variant="secondary" className="text-xs" onClick={unoPorFactura}>Un pago por cada factura</Button>}
            </div>
          </div>
          <p className="text-xs text-slate-500">Si un solo comprobante (por ejemplo de $10,000) pagó varias facturas, agrega ese pago una vez y palomea las facturas que cubre.</p>
          {pagos.map((p, i) => {
            const suma = sumaPago(p.key);
            const dif = Number(p.monto || 0) - suma;
            return (
              <div key={p.key} className="space-y-3 rounded-xl border-2 border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">Pago {i + 1}</span>
                  <button type="button" onClick={() => quitarPago(p.key)} className="text-xs text-red-700 hover:underline">Quitar pago</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <label className="text-xs font-medium text-slate-600">Fecha de pago<Input type="date" value={p.fecha} max={hoy()} onChange={(e) => setP(p.key, "fecha", e.target.value)} /></label>
                  <label className="text-xs font-medium text-slate-600">Monto total del pago<Input type="number" min="0" step="0.01" inputMode="decimal" value={p.monto} onChange={(e) => setP(p.key, "monto", e.target.value)} placeholder="10000" /></label>
                  <label className="text-xs font-medium text-slate-600">Forma de pago
                    <Select value={p.forma} onChange={(e) => setP(p.key, "forma", e.target.value)}>
                      {(Object.keys(FORMAS_PAGO) as FormaPago[]).map((f) => <option key={f} value={f}>{FORMAS_PAGO[f]}</option>)}
                    </Select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">Referencia (opcional)<Input value={p.referencia} maxLength={120} onChange={(e) => setP(p.key, "referencia", e.target.value)} placeholder="Folio SPEI, # cheque" /></label>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-slate-600">Facturas que cubre este pago:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {elegidas.map((f) => {
                      const aqui = asig[f.id] === p.key;
                      const otro = asig[f.id] != null && !aqui;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          disabled={otro}
                          onClick={() => setAsig((a) => { const n = { ...a }; if (aqui) delete n[f.id]; else n[f.id] = p.key; return n; })}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${aqui ? "border-green-600 bg-green-600 text-white" : otro ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-300 bg-white text-slate-700 hover:border-green-600"}`}
                          title={otro ? `Ya está en el pago ${pagos.findIndex((x) => x.key === asig[f.id]) + 1}` : ""}
                        >
                          {aqui ? "✓ " : ""}{f.factura} · {money(f.monto, f.moneda)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className={`text-xs ${Math.abs(dif) < 1 || !p.monto ? "text-slate-500" : "font-semibold text-amber-800"}`}>
                  Suma de facturas: {money(suma)}
                  {p.monto && Math.abs(dif) >= 1 ? ` · el pago ${dif > 0 ? "es mayor" : "es menor"} por ${money(Math.abs(dif))}. Revisa que estén todas las facturas.` : ""}
                </p>
              </div>
            );
          })}
          {pagos.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Agrega el pago o los pagos con que te pagaron estas facturas.</p>}
          {pagos.length > 0 && sinPago.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Falta decir con qué pago se cobró: {sinPago.map((f) => f.factura).join(", ")}</p>
          )}
        </Card>
      )}

      {elegidas.length > 0 && (
        <Card className="space-y-3 p-4">
          <h2 className="text-base font-semibold text-slate-900">3. Entregar a finanzas</h2>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} rows={2} placeholder="Nota para finanzas (opcional)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={enviar} loading={pend} disabled={!listo}>
              Entregar {elegidas.length} factura(s) en {pagos.length} pago(s)
            </Button>
            {!listo && <span className="text-xs text-slate-500">Completa la fecha y el monto de cada pago y asigna todas las facturas.</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
