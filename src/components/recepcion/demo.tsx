"use client";

import { useState } from "react";
import { EntregarFacturas, type EntregaPayload, type FacturaDisponible } from "@/components/recepcion/entregar";
import { EntregasHistorial } from "@/components/recepcion/historial";
import { toast } from "@/components/feedback-global";
import { Button, Card, StatCard } from "@/components/ui";
import type { EntregaRec } from "@/lib/recepcion";

const VENDEDOR = "Ana López (vendedora demo)";
const AUX = "Auxiliar de finanzas (demo)";

const FACTURAS: FacturaDisponible[] = [
  { id: "d1", factura: "ESC-5101", cliente: "PINTURAS FAMOSAS", fecha: "2026-11-03", fecha_cobro: "2026-11-17", monto: 2500, moneda: "MXN", rechazada: false },
  { id: "d2", factura: "ESC-5104", cliente: "PINTURAS FAMOSAS", fecha: "2026-11-04", fecha_cobro: "2026-11-17", monto: 3200, moneda: "MXN", rechazada: false },
  { id: "d3", factura: "ESC-5110", cliente: "PINTURAS FAMOSAS", fecha: "2026-11-06", fecha_cobro: "2026-11-17", monto: 1800, moneda: "MXN", rechazada: false },
  { id: "d4", factura: "ESC-5112", cliente: "PINTURAS FAMOSAS", fecha: "2026-11-07", fecha_cobro: "2026-11-17", monto: 2500, moneda: "MXN", rechazada: false },
  { id: "d5", factura: "ESC-5120", cliente: "SIGMA ALIMENTOS", fecha: "2026-11-10", fecha_cobro: "2026-11-19", monto: 8740.5, moneda: "MXN", rechazada: false },
  { id: "d6", factura: "ESC-5127", cliente: "TEN QUIMICA", fecha: "2026-11-12", fecha_cobro: "2026-11-20", monto: 5962, moneda: "MXN", rechazada: false },
  { id: "d7", factura: "ESC-5133", cliente: "ENSAMBLES DEL NORTE", fecha: "2026-11-14", fecha_cobro: "2026-11-21", monto: 1250, moneda: "MXN", rechazada: false },
];

/** Demostracion de Recepcion de facturas: todo vive en esta pantalla, nada se guarda en la base. */
export function RecepcionDemo() {
  const [vista, setVista] = useState<"vendedor" | "finanzas">("vendedor");
  const [entregas, setEntregas] = useState<EntregaRec[]>([]);
  const [n, setN] = useState(1);

  const todas = entregas.flatMap((e) => e.pagos.flatMap((p) => p.facturas));
  const vivas = new Set(todas.filter((f) => f.estado !== "rechazada").map((f) => f.venta_id));
  const rech = new Set(todas.filter((f) => f.estado === "rechazada").map((f) => f.venta_id));
  const disponibles = FACTURAS.filter((f) => !vivas.has(f.id)).map((f) => ({ ...f, rechazada: rech.has(f.id) }));
  const porRevisar = todas.filter((f) => f.estado === "por_revisar").length;

  const entregar = (p: EntregaPayload) => {
    const id = `ent${n}`;
    const ahora = new Date().toISOString();
    setN(n + 1);
    setEntregas((es) => [
      {
        id, folio: `ENT-DEMO-${String(n).padStart(3, "0")}`, notas: p.notas || null, estado: "por_revisar", created_at: ahora, notasLista: [],
        pagos: p.pagos.map((pg, i) => ({
          id: `${id}-p${i}`, fecha: pg.fecha, monto: pg.monto, moneda: pg.moneda, forma: pg.forma, referencia: pg.referencia || null,
          facturas: pg.ventas.map((vid) => {
            const f = FACTURAS.find((x) => x.id === vid)!;
            return { id: `${id}-${vid}`, venta_id: vid, estado: "por_revisar" as const, motivo: null, revisado_at: null, factura: f.factura, cliente: f.cliente, fecha_factura: f.fecha, monto: f.monto, moneda: f.moneda };
          }),
        })),
      },
      ...es,
    ]);
    toast("Le llegó el aviso a finanzas. Cambia a la pestaña “Como auxiliar de finanzas”.", "info");
  };
  const demo = (autor: string) => ({
    revisar: (rid: string, estado: "por_revisar" | "recibida" | "rechazada", motivo?: string) =>
      setEntregas((es) =>
        es.map((e) => {
          const pagos = e.pagos.map((p) => ({ ...p, facturas: p.facturas.map((f) => (f.id === rid ? { ...f, estado, motivo: estado === "rechazada" ? motivo ?? null : null } : f)) }));
          return { ...e, pagos, estado: pagos.some((p) => p.facturas.some((f) => f.estado === "por_revisar")) ? "por_revisar" : "revisada" };
        }),
      ),
    nota: (eid: string, texto: string) =>
      setEntregas((es) => es.map((e) => (e.id === eid ? { ...e, notasLista: [...e.notasLista, { id: `${eid}-n${e.notasLista.length}`, texto, autor_nombre: autor, created_by: null, created_at: new Date().toISOString() }] } : e))),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-violet-500 bg-violet-50 px-4 py-3">
        <p className="text-sm text-violet-950"><b>DEMOSTRACIÓN.</b> Datos de ejemplo: nada se guarda ni cuenta en ventas o indicadores. Al recargar la página empieza de cero.</p>
        <Button type="button" variant="secondary" className="text-xs" onClick={() => { setEntregas([]); setN(1); setVista("vendedor"); }}>Reiniciar demo</Button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-grid">
        {(["vendedor", "finanzas"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setVista(v)} className={`whitespace-nowrap rounded-md px-5 py-2.5 ${vista === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>
            {v === "vendedor" ? "Como vendedor" : `Como auxiliar de finanzas${porRevisar ? ` (${porRevisar})` : ""}`}
          </button>
        ))}
      </div>

      {vista === "vendedor" ? (
        <div className="space-y-5">
          <p className="text-sm text-slate-600">Así lo ve <b>{VENDEDOR}</b>: sus facturas ya cobradas. Elige cuáles trae en físico y con qué pago se cobró cada una.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Cobradas sin entregar" value={disponibles.length} />
            <StatCard label="En revisión" value={porRevisar} tone={porRevisar ? "amber" : "default"} />
            <StatCard label="Recibidas" value={todas.filter((f) => f.estado === "recibida").length} tone="green" />
            <StatCard label="Rechazadas" value={disponibles.filter((d) => d.rechazada).length} tone={disponibles.some((d) => d.rechazada) ? "red" : "default"} />
          </div>
          <EntregarFacturas key={entregas.length} facturas={disponibles} demo={entregar} />
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Mis entregas a finanzas</h2>
            <EntregasHistorial entregas={entregas} modo="vendedor" demo={demo(VENDEDOR)} />
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Así lo ve la <b>Auxiliar de administración y finanzas</b>. Escribe el folio de cada factura física (Enter la marca recibida), rechaza las que no vinieron y anota lo que no cuadre.</p>
          <Card className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="font-semibold text-slate-900">{VENDEDOR}</span>
            {porRevisar ? <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">{porRevisar} por recibir</span> : <span className="text-xs text-slate-400">Al corriente</span>}
          </Card>
          {entregas.length === 0 ? (
            <Card className="text-sm text-slate-600">Todavía no hay entregas. Ve a “Como vendedor” y entrega algunas facturas.</Card>
          ) : (
            <EntregasHistorial entregas={entregas} modo="finanzas" demo={demo(AUX)} />
          )}
        </div>
      )}
    </div>
  );
}
