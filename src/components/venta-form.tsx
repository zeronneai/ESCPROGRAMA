"use client";

import Link from "next/link";
import { useState } from "react";
import { cancelarVentaAction, saveVentaAction } from "@/actions/ventas";
import { ArticuloSearch } from "@/components/articulos-picker";
import { KindBadgeStatic } from "@/components/kind-badge";
import { areaCls, CustomerLookup, useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Input, Select } from "@/components/ui";
import type { CustomerRecord } from "@/lib/validation/customer";
import { cobroEstado, diasVencidos, money, saldo, type VentaInput, type VentaLinea, type VentaRow } from "@/lib/ventas";

type Cust = Pick<CustomerRecord, "id" | "nombre" | "tipo" | "contacto_nombre" | "contacto_telefono" | "giro" | "estado_geo">;

export function VentaForm({
  venta, lineas: initialLineas, customer: initialCustomer, today, readOnly = false, backHref = "/vendedor/bitacora", requestFolio,
}: {
  venta: VentaRow | null;
  lineas: VentaLinea[];
  customer: Cust | null;
  today: string;
  readOnly?: boolean;
  backHref?: string;
  requestFolio?: string | null;
}) {
  const [customer, setCustomer] = useState<Cust | null>(initialCustomer);
  const [lineas, setLineas] = useState<VentaLinea[]>(initialLineas);
  const [libre, setLibre] = useState("");
  const [v, setV] = useState({
    fecha: venta?.fecha ?? today,
    pedido: venta?.pedido ?? "",
    factura: venta?.factura ?? "",
    monto: venta?.monto != null ? String(Number(venta.monto)) : "",
    moneda: venta?.moneda ?? "MXN",
    pago: venta?.pago ?? "contado",
    dias_credito: venta?.dias_credito != null ? String(venta.dias_credito) : "30",
    entregado: venta?.entregado ?? false,
    porcentaje_cobrado: venta ? String(Number(venta.porcentaje_cobrado)) : "0",
    comentarios: venta?.comentarios ?? "",
  });
  const { run, busy, notice, router } = useRun();
  const ro = readOnly || !!venta?.cancelada_at;
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const estado = venta ? cobroEstado(venta, today) : null;

  function save() {
    if (!customer) return;
    const input: VentaInput = { ...v, customer_id: customer.id, monto: v.monto, dias_credito: v.pago === "credito" ? v.dias_credito : null };
    run("save", () => saveVentaAction(venta?.id ?? null, input, lineas), (r) => {
      if (r.ok) router.push(backHref);
    });
  }

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {venta?.cancelada_at && <Alert tone="error">Esta venta está cancelada.</Alert>}
      {venta?.origen === "portal" && !venta.cancelada_at && (
        <Alert tone="info">Se registró sola al marcar Ganada {requestFolio ? `la solicitud ${requestFolio}` : "una partida del portal"}. Completa factura, pago y entrega.</Alert>
      )}
      {estado === "vencida" && venta && (
        <Alert tone="error">Cartera vencida: {diasVencidos(venta, today)} días, saldo {money(saldo(venta), venta.moneda)}.</Alert>
      )}

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Fecha</span>
            <Input type="date" value={v.fecha} onChange={set("fecha")} disabled={ro} />
          </label>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Cliente *</span>
            {customer ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="font-medium text-slate-900">{customer.nombre}</span>
                <KindBadgeStatic tipo={customer.tipo} />
                <span className="text-xs text-slate-500">{[customer.contacto_nombre, customer.contacto_telefono].filter(Boolean).join(" · ")}</span>
                {!ro && !venta && <button type="button" onClick={() => setCustomer(null)} className="ml-auto text-xs text-brand-700 underline">Cambiar</button>}
              </div>
            ) : (
              <CustomerLookup placeholder="Busca al cliente (nombre, RFC o contacto)" onPick={(c) => setCustomer(c)} />
            )}
            {customer?.tipo === "prospecto" && !venta && (
              <p className="text-xs text-green-700">Era prospecto: al guardar esta venta pasa a cliente y cuenta como prospecto convertido.</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-600">Artículos vendidos</span>
          {lineas.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
              {lineas.map((l, i) => (
                <li key={l.id ?? `n${i}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-slate-900">{l.descripcion}</p>
                    {l.clave && <p className="text-xs text-slate-500">{l.clave}</p>}
                  </div>
                  <input
                    value={l.cantidad ?? ""}
                    disabled={ro}
                    inputMode="decimal"
                    placeholder="Cant."
                    onChange={(e) => setLineas((x) => x.map((y, j) => (j === i ? { ...y, cantidad: e.target.value.trim() ? Number(e.target.value) || null : null } : y)))}
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                  />
                  {!ro && <button type="button" onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} className="px-1 text-lg leading-none text-slate-400 hover:text-red-600" aria-label="Quitar">×</button>}
                </li>
              ))}
            </ul>
          )}
          {!ro && (
            <>
              <ArticuloSearch exclude={lineas.map((l) => l.articulo_id ?? "")} onPick={(a) => setLineas((x) => [...x, { id: null, articulo_id: a.id, descripcion: a.nombre, clave: a.clave, cantidad: null }])} />
              <div className="flex gap-2">
                <Input value={libre} onChange={(e) => setLibre(e.target.value)} placeholder="¿No está en el catálogo? Escríbelo aquí" />
                <Button type="button" variant="secondary" disabled={libre.trim().length < 2} onClick={() => { setLineas((x) => [...x, { id: null, articulo_id: null, descripcion: libre.trim(), cantidad: null }]); setLibre(""); }}>Agregar</Button>
              </div>
            </>
          )}
          {ro && lineas.length === 0 && <p className="text-sm text-slate-500">Sin artículos.</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Pedido / OC</span>
            <Input value={v.pedido} onChange={set("pedido")} disabled={ro} placeholder="OC del cliente" />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Factura</span>
            <Input value={v.factura} onChange={set("factura")} disabled={ro} />
          </label>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Monto sin IVA</span>
            <div className="flex gap-2">
              <Input value={v.monto} onChange={set("monto")} disabled={ro} inputMode="decimal" placeholder="0.00" />
              <Select value={v.moneda} onChange={set("moneda")} disabled={ro} className="w-24!"><option>MXN</option><option>USD</option></Select>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Pago</span>
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
              {(["contado", "credito"] as const).map((p) => (
                <button key={p} type="button" disabled={ro} onClick={() => setV((s) => ({ ...s, pago: p }))} className={`flex-1 rounded px-3 py-1.5 ${v.pago === p ? "bg-slate-800 text-white" : "text-slate-600"}`}>
                  {p === "contado" ? "Contado" : "Crédito"}
                </button>
              ))}
            </div>
            {v.pago === "credito" && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                <span className="text-slate-600">Días:</span>
                {["15", "30", "45", "60"].map((d) => (
                  <button key={d} type="button" disabled={ro} onClick={() => setV((s) => ({ ...s, dias_credito: d }))} className={`rounded-full px-2.5 py-1 ${v.dias_credito === d ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}>{d}</button>
                ))}
                <input value={v.dias_credito} onChange={set("dias_credito")} disabled={ro} inputMode="numeric" className="w-14 rounded border border-slate-300 px-2 py-1" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Entrega</span>
            <label className="flex h-[38px] items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm">
              <input type="checkbox" checked={v.entregado} disabled={ro} onChange={(e) => setV((s) => ({ ...s, entregado: e.target.checked }))} />
              {v.entregado ? `Entregado${venta?.fecha_entrega ? ` el ${new Date(`${venta.fecha_entrega}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : ""}` : "Pendiente de entregar"}
            </label>
          </div>
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600">Cobrado</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {["0", "50", "100"].map((p) => (
                <button key={p} type="button" disabled={ro} onClick={() => setV((s) => ({ ...s, porcentaje_cobrado: p }))} className={`rounded-full px-3 py-1.5 text-xs ${Number(v.porcentaje_cobrado) === Number(p) ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700"}`}>{p}%</button>
              ))}
              <input value={v.porcentaje_cobrado} onChange={set("porcentaje_cobrado")} disabled={ro} inputMode="decimal" className="w-16 rounded border border-slate-300 px-2 py-1 text-sm" />
              <span className="text-xs text-slate-500">%</span>
            </div>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Comentarios</span>
          <textarea value={v.comentarios} onChange={set("comentarios")} disabled={ro} rows={2} className={areaCls} placeholder="Algo a tomar en cuenta: acuerdos de pago, entrega parcial, etc." />
        </label>
      </Card>

      {!ro && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <Button onClick={save} loading={busy === "save"} disabled={!customer} className="flex-1 sm:flex-none">{venta ? "Guardar cambios" : "Registrar venta"}</Button>
          <Link href={backHref} className="px-3 py-2 text-sm text-slate-600">Volver</Link>
          {venta && (
            <Button variant="ghost" className="ml-auto text-xs text-red-700" loading={busy === "x"} onClick={() => { if (window.confirm("¿Cancelar esta venta? Queda registrada como cancelada.")) run("x", () => cancelarVentaAction(venta.id), () => router.push(backHref)); }}>
              Cancelar venta
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
