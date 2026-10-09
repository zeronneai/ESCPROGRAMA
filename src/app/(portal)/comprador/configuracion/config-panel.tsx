"use client";

import { useState, useTransition } from "react";
import { addHolidayAction, removeHolidayAction, savePricingAction, saveSettingsAction } from "@/actions/config";
import type { Result } from "@/actions/requests";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

interface PricingRow {
  id: number;
  no_shipping_markup: number;
  p1: number; p2: number; p3: number; p4: number; p5: number;
  created_at: string;
  profiles: { nombre: string } | null;
}

export function ConfigPanel(props: {
  history: PricingRow[];
  settings: { timezone: string; sla_business_hours: number; warn_business_hours: number };
  holidays: { fecha: string; descripcion: string | null }[];
}) {
  const cur = props.history[0];
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pricing, setPricing] = useState({
    markupPct: String(Math.round(cur.no_shipping_markup * 10000) / 100),
    p1: String(cur.p1), p2: String(cur.p2), p3: String(cur.p3), p4: String(cur.p4), p5: String(cur.p5),
  });
  const [settings, setSettings] = useState({
    timezone: props.settings.timezone,
    sla: String(props.settings.sla_business_hours),
    warn: String(props.settings.warn_business_hours),
  });
  const [holiday, setHoliday] = useState({ fecha: "", descripcion: "" });

  function run(fn: () => Promise<Result>, okText: string, after?: () => void) {
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setNotice({ tone: "success", text: okText });
        after?.();
      } else setNotice({ tone: "error", text: r.error });
    });
  }

  const fnum = (k: "p1" | "p2" | "p3" | "p4" | "p5", label: string) => (
    <Field label={label}>
      <Input value={pricing[k]} onChange={(e) => setPricing({ ...pricing, [k]: e.target.value })} inputMode="decimal" />
    </Field>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Configuracion</h1>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <Card className="space-y-3">
        <h2 className="font-medium">Tabulador de precios</h2>
        <p className="text-sm text-slate-600">
          Un cambio aplica solo a cotizaciones nuevas: cada cotizacion guarda los factores que uso. El historial queda con fecha y usuario.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Cargo sin envio (%)">
            <Input value={pricing.markupPct} onChange={(e) => setPricing({ ...pricing, markupPct: e.target.value })} inputMode="decimal" />
          </Field>
          {fnum("p5", "Factor Precio 5")}
          {fnum("p4", "Factor Precio 4")}
          {fnum("p3", "Factor Precio 3")}
          {fnum("p2", "Factor Precio 2")}
          {fnum("p1", "Factor Precio 1")}
        </div>
        <Button
          disabled={pending}
          onClick={() => {
            if (confirm("Guardar nuevos factores? Aplican a las cotizaciones que se capturen desde ahora.")) {
              run(() => savePricingAction(pricing), "Factores guardados");
            }
          }}
        >
          Guardar factores
        </Button>
        <details>
          <summary className="cursor-pointer text-sm">Historial de cambios ({props.history.length})</summary>
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pr-2">Fecha</th><th className="pr-2">Usuario</th><th className="pr-2">Sin envio</th>
                <th className="pr-2">P5</th><th className="pr-2">P4</th><th className="pr-2">P3</th><th className="pr-2">P2</th><th>P1</th>
              </tr>
            </thead>
            <tbody>
              {props.history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="pr-2">{new Date(h.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="pr-2">{h.profiles?.nombre ?? "-"}</td>
                  <td className="pr-2">{Math.round(h.no_shipping_markup * 10000) / 100}%</td>
                  <td className="pr-2">{h.p5}</td><td className="pr-2">{h.p4}</td><td className="pr-2">{h.p3}</td><td className="pr-2">{h.p2}</td><td>{h.p1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Plazos y zona horaria</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Zona horaria">
            <Input value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} />
          </Field>
          <Field label="Plazo de respuesta (horas habiles)">
            <Input value={settings.sla} onChange={(e) => setSettings({ ...settings, sla: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Aviso previo (horas habiles restantes)">
            <Input value={settings.warn} onChange={(e) => setSettings({ ...settings, warn: e.target.value })} inputMode="numeric" />
          </Field>
        </div>
        <Button disabled={pending} onClick={() => run(() => saveSettingsAction(settings), "Configuracion guardada")}>
          Guardar
        </Button>
        <p className="text-xs text-slate-500">El plazo aplica a solicitudes que se envien desde ahora. Sabado y domingo nunca cuentan.</p>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-medium">Dias festivos (no cuentan para el plazo)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Fecha">
            <Input type="date" value={holiday.fecha} onChange={(e) => setHoliday({ ...holiday, fecha: e.target.value })} />
          </Field>
          <Field label="Descripcion (opcional)">
            <Input value={holiday.descripcion} onChange={(e) => setHoliday({ ...holiday, descripcion: e.target.value })} />
          </Field>
          <Button disabled={pending || !holiday.fecha} onClick={() => run(() => addHolidayAction(holiday), "Dia agregado", () => setHoliday({ fecha: "", descripcion: "" }))}>
            Agregar
          </Button>
        </div>
        {props.holidays.length === 0 ? (
          <p className="text-sm text-slate-500">No hay festivos registrados.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {props.holidays.map((h) => (
              <li key={h.fecha} className="flex items-center justify-between py-1">
                <span>
                  {h.fecha} {h.descripcion && <span className="text-slate-500">- {h.descripcion}</span>}
                </span>
                <Button variant="ghost" disabled={pending} onClick={() => run(() => removeHolidayAction(h.fecha), "Dia quitado")}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
