import { DateTime } from "luxon";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { PurchaseButton } from "./purchase-button";

export interface PorComprarRow {
  item_id: string; request_id: string; folio: string | null; cliente: string; producto: string; cantidad: number | null; unidad: string | null; talla: string | null;
  proveedor: string | null; link_producto: string | null; contacto: string | null; numero_parte: string | null; notas_compra: string | null;
  costo: number; envio: number | null; moneda: "MXN" | "USD"; version: number; ganada_at: string; comprada_at: string | null; comprada_por: string | null; falta_proveedor: boolean;
}

/** Por comprar (solo comprador): partidas con resultado Ganada y a donde ir a conseguirlas. */
export default async function PorComprar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireBuyer();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const estado = sp.estado === "compradas" || sp.estado === "todas" ? sp.estado : "pendientes";
  const toIso = (d: string | undefined, end: boolean) =>
    d ? (end ? DateTime.fromISO(d, { zone: cfg.timezone }).endOf("day") : DateTime.fromISO(d, { zone: cfg.timezone }).startOf("day")).toUTC().toISO() : null;
  const [{ data, error }, { data: sup }] = await Promise.all([
    supabase.rpc("por_comprar", { p_proveedor: sp.proveedor || null, p_desde: toIso(sp.desde, false), p_hasta: toIso(sp.hasta, true), p_estado: estado }),
    supabase.from("suppliers").select("nombre").order("nombre"),
  ]);
  const rows = (data ?? []) as PorComprarRow[];
  const qs = new URLSearchParams(Object.entries({ proveedor: sp.proveedor, desde: sp.desde, hasta: sp.hasta, estado }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Por comprar</h1>
        <div className="flex gap-2 text-sm">
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-100" href={`/api/admin/export?tipo=por_comprar&formato=xlsx&${qs}`}>Exportar Excel</a>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-100" href={`/api/admin/export?tipo=por_comprar&formato=csv&${qs}`}>Exportar CSV</a>
        </div>
      </div>
      <p className="text-sm text-slate-600">Cotizaciones ganadas. Información interna: el vendedor no la ve.</p>

      <form method="get" className="grid items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-5">
        <Field label="Proveedor">
          <Input name="proveedor" list="provs-pc" defaultValue={sp.proveedor ?? ""} />
          <datalist id="provs-pc">{(sup ?? []).map((s) => <option key={s.nombre} value={s.nombre} />)}</datalist>
        </Field>
        <Field label="Ganada desde"><Input type="date" name="desde" defaultValue={sp.desde ?? ""} /></Field>
        <Field label="Hasta"><Input type="date" name="hasta" defaultValue={sp.hasta ?? ""} /></Field>
        <Field label="Estado">
          <Select name="estado" defaultValue={estado}>
            <option value="pendientes">Por comprar</option>
            <option value="compradas">Compradas</option>
            <option value="todas">Todas</option>
          </Select>
        </Field>
        <Button type="submit">Filtrar</Button>
      </form>
      {error && <p className="text-sm text-red-700">{error.message}</p>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2">Partida</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2">Cantidad</th>
              <th className="px-3 py-2">Dónde conseguirlo</th><th className="px-3 py-2">Costo vigente</th><th className="px-3 py-2">Compra</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No hay partidas en esta vista.</td></tr>}
            {rows.map((r) => (
              <tr key={r.item_id} className="border-t border-slate-200 align-top">
                <td className="px-3 py-2 whitespace-nowrap">{r.folio}</td>
                <td className="px-3 py-2">{r.cliente}</td>
                <td className="px-3 py-2">{r.producto}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.cantidad ? `${Number(r.cantidad)} ${r.unidad ?? ""}` : r.talla ? `Talla ${r.talla}` : "-"}</td>
                <td className="space-y-0.5 px-3 py-2 text-xs">
                  {r.falta_proveedor && <p className="rounded bg-red-100 px-2 py-1 font-medium text-red-800">Falta definir proveedor</p>}
                  {r.proveedor && <p><strong>{r.proveedor}</strong></p>}
                  {r.link_producto && (
                    <p>
                      <a href={r.link_producto} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 underline">{r.link_producto}</a>
                    </p>
                  )}
                  {r.contacto && <p>Contacto: {r.contacto}</p>}
                  {r.numero_parte && <p>Parte: {r.numero_parte}</p>}
                  {r.notas_compra && <p className="text-slate-600">{r.notas_compra}</p>}
                </td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  ${Number(r.costo).toFixed(2)} {r.moneda}
                  {r.envio ? <div className="text-xs text-slate-500">+ envío ${Number(r.envio).toFixed(2)}</div> : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <PurchaseButton itemId={r.item_id} compradaAt={r.comprada_at} por={r.comprada_por} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
