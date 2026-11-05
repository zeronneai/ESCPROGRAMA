"use client";

import { useState } from "react";
import { demoCargarAction, demoQuitarAction } from "@/actions/demo";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card } from "@/components/ui";

export const DEMO_SECCIONES = [
  { id: "clientes", label: "Clientes y prospectos", hint: "8 empresas ficticias con (Demo) en el nombre", needs: ["vendedor"] },
  { id: "cotizaciones", label: "Solicitudes de cotización", hint: "Con compras, cotizadas, enviadas, ganada y perdida", needs: ["vendedor", "comprador"] },
  { id: "bitacora", label: "Bitácora de ventas / prospección", hint: "Etapas, artículos, cartera, prospecto convertido y uno del sitio web", needs: ["vendedor"] },
  { id: "calidad", label: "Quejas y acción correctiva", hint: "3 quejas y una SAC con plan de acción", needs: ["vendedor", "coordinador_iso"] },
  { id: "consumo", label: "Consumo interno", hint: "Por aprobar, aprobada, agendada y recibida", needs: ["vendedor", "jefe_ventas"] },
  { id: "guias", label: "Guías de paquetería", hint: "Una con más de 2 h, una con datos faltantes y por atender", needs: ["vendedor", "marketplaces"] },
] as const;

const ROL: Record<string, string> = { vendedor: "Vendedor", comprador: "Comprador", coordinador_iso: "Coordinador ISO", jefe_ventas: "Jefa de ventas", marketplaces: "Marketplaces" };

export function DemoPanel({ cargadas, listos }: { cargadas: { seccion: string; detalle: string | null; cargado_at: string }[]; listos: Record<string, number> }) {
  const { run, busy, notice, setNotice, router } = useRun();
  const done = new Map(cargadas.map((c) => [c.seccion, c]));
  const [confirmar, setConfirmar] = useState(false);
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Demostración</h2>
        <p className="text-sm text-slate-500">
          Llena el portal con ejemplos para presentarlo. Se crean con los usuarios reales (como si ellos lo hubieran capturado), así que cada quien ve lo suyo al entrar.
          Cada usuario debe haber entrado al menos una vez (para cambiar su contraseña temporal).
        </p>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {Object.entries(ROL).map(([k, l]) => (
          <span key={k} className={`rounded-full px-2.5 py-1 font-medium ${listos[k] ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>
            {l}: {listos[k] ? `${listos[k]} listo(s)` : "falta"}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {DEMO_SECCIONES.map((s) => {
          const c = done.get(s.id);
          const missing = s.needs.filter((r) => !listos[r]);
          return (
            <li key={s.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-medium text-slate-900">{s.label}</p>
                <p className="text-xs text-slate-500">{c ? `Cargada: ${c.detalle}` : s.hint}</p>
                {!c && missing.length > 0 && <p className="text-xs text-amber-800">Sin {missing.map((r) => ROL[r]).join(" ni ")} se carga incompleta.</p>}
              </div>
              {c ? (
                <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">Activa</span>
              ) : (
                <Button variant="secondary" className="shrink-0 text-xs" loading={busy === s.id} disabled={!listos.vendedor || !!busy} onClick={() => run(s.id, () => demoCargarAction(s.id), "Listo. Ya puedes mostrarla.")}>
                  Activar
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={busy === "todo"} disabled={!listos.vendedor || !!busy || done.size >= DEMO_SECCIONES.length} onClick={() => run("todo", () => demoCargarAction("todo"), "Listo. Toda la demostración está cargada.")}>
          Activar todo
        </Button>
      </div>
      <div className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
        <p className="text-sm font-medium text-slate-900">Quitar la demostración</p>
        <p className="text-xs text-slate-600">
          Borra los clientes con (Demo) en el nombre y todo lo ligado a ellos (solicitudes, bitácora, ventas, quejas, guías, encuestas) más las
          solicitudes de consumo de ejemplo. Lo que hayan capturado de verdad no se toca.
        </p>
        {confirmar ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-red-800">¿Seguro? No se puede deshacer.</span>
            <Button
              className="bg-red-600 text-xs hover:bg-red-700"
              loading={busy === "quitar"}
              disabled={!!busy}
              onClick={() => run("quitar", () => demoQuitarAction(), (r) => {
                setConfirmar(false);
                setNotice({ tone: "success", text: `Listo. Se quitaron ${(r as unknown as { detalle: string }).detalle}.` });
                router.refresh();
              })}
            >
              Sí, quitarla
            </Button>
            <Button variant="ghost" className="text-xs" onClick={() => setConfirmar(false)} disabled={!!busy}>Cancelar</Button>
          </div>
        ) : (
          <Button variant="secondary" className="text-xs" disabled={!!busy} onClick={() => setConfirmar(true)}>
            Quitar demostración
          </Button>
        )}
      </div>
    </Card>
  );
}
