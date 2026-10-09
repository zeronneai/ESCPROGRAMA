import Link from "next/link";
import { CountBar, WeeklyTrend } from "@/components/stats-charts";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import { computeBuyerStats } from "@/lib/stats/buyer-stats";
import { defaultRange, fetchStatItems, toStatRows } from "@/lib/stats/queries";
import { createClient } from "@/lib/supabase/server";

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 1000) / 10}%`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default async function Estadisticas({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireBuyer();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const def = defaultRange(cfg.timezone);
  const f = {
    desde: sp.desde || def.desde,
    hasta: sp.hasta || def.hasta,
    vendedor: sp.vendedor || undefined,
    cliente: sp.cliente || undefined,
    moneda: sp.moneda || undefined,
  };
  const [items, { data: vendedores }, { data: clientes }] = await Promise.all([
    fetchStatItems(supabase, f, cfg.timezone),
    supabase.from("profiles").select("id, nombre").eq("rol", "vendedor").order("nombre"),
    supabase.from("customers").select("id, nombre").order("nombre"),
  ]);
  const s = computeBuyerStats(toStatRows(items), cfg.timezone);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Estadisticas</h1>
        <div className="flex gap-2 text-sm">
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-100" href={`/api/admin/export?tipo=partidas&formato=xlsx&${qs}`}>
            Exportar Excel
          </a>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-100" href={`/api/admin/export?tipo=partidas&formato=csv&${qs}`}>
            Exportar CSV
          </a>
        </div>
      </div>

      <form className="grid items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-6" method="get">
        <Field label="Desde">
          <Input type="date" name="desde" defaultValue={f.desde} />
        </Field>
        <Field label="Hasta">
          <Input type="date" name="hasta" defaultValue={f.hasta} />
        </Field>
        <Field label="Vendedor">
          <Select name="vendedor" defaultValue={f.vendedor ?? ""}>
            <option value="">Todos</option>
            {(vendedores ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cliente">
          <Select name="cliente" defaultValue={f.cliente ?? ""}>
            <option value="">Todos</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Moneda">
          <Select name="moneda" defaultValue={f.moneda ?? ""}>
            <option value="">Todas</option>
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit">Aplicar</Button>
          <Link href="/comprador/estadisticas" className="self-center text-sm text-slate-600 underline">
            Limpiar
          </Link>
        </div>
      </form>

      <p className="text-xs text-slate-500">
        Rango por fecha de envio de la solicitud ({f.desde} a {f.hasta}). Las cifras cuentan partidas. Con filtro de moneda solo entran partidas cotizadas.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Partidas / solicitudes" value={`${s.totalPartidas} / ${s.solicitudes}`} />
        <Kpi label="Tasa de respuesta" value={pct(s.tasaRespuesta)} hint={`${s.respondidas} respondidas`} />
        <Kpi label="Respondidas dentro del plazo" value={pct(s.dentroDePlazo)} />
        <Kpi label="Tiempo promedio de respuesta" value={s.promedioHoras === null ? "-" : `${Math.round(s.promedioHoras * 10) / 10} h habiles`} />
        <Kpi label="Tasa de no encontrada" value={pct(s.tasaNoEncontrada)} hint={`${s.noEncontradas} partidas`} />
        <Kpi label="Enviado al cliente" value={pct(s.pctEnviado)} hint={`${s.enviadas} de ${s.cotizadas} cotizadas`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountBar title="Cotizaciones por vendedor" data={s.porVendedor} horizontal />
        <CountBar title="Cotizaciones por cliente" data={s.porCliente} horizontal />
        <CountBar title="Cotizaciones por mes" data={s.porMes} />
        <CountBar title="Que precio eligen los vendedores (enviadas al cliente)" data={s.distribucionPrecio} />
        <CountBar title="Razones mas frecuentes de no encontrada" data={s.razones} horizontal />
        <WeeklyTrend data={s.tendenciaSemanal} />
      </div>
    </div>
  );
}
