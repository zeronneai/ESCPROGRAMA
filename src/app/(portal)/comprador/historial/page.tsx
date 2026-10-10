import { CostHistoryChart } from "@/components/cost-history-chart";
import { Button, Card, Field, Input } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

const RESULT = { sin_respuesta: "Sin respuesta", ganada: "Ganada", perdida: "Perdida" } as const;

/** Historial de precios (solo comprador): busca por producto o proveedor. */
export default async function Historial({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireBuyer();
  const sp = await searchParams;
  const producto = sp.producto?.trim() ?? "";
  const proveedor = sp.proveedor?.trim() ?? "";
  const supabase = await createClient();
  const [{ data: rows, error }, { data: hist }, { data: sup }] = await Promise.all([
    producto || proveedor
      ? supabase.rpc("similar_quotes", { p_name: producto || null, p_proveedor: proveedor || null, p_exclude_item: null, p_limit: 50 })
      : Promise.resolve({ data: [], error: null }),
    producto ? supabase.rpc("product_cost_history", { p_name: producto, p_limit: 300 }) : Promise.resolve({ data: [] }),
    supabase.from("suppliers").select("nombre").order("nombre"),
  ]);
  const list = (rows ?? []) as Array<{
    item_id: string; version: number; folio: string | null; producto: string; cliente: string; quoted_at: string; costo: number; envio: number | null; descripcion: string; alt_nombre: string | null;
    moneda: "MXN" | "USD"; proveedor: string | null; precio_elegido: number | null; valor_elegido: number | null; resultado: keyof typeof RESULT | null;
  }>;
  const points = ((hist ?? []) as Array<{ quoted_at: string; costo: number; moneda: "MXN" | "USD"; proveedor: string | null; producto: string; version: number }>).map((p) => ({
    fecha: p.quoted_at,
    costo: Number(p.costo),
    moneda: p.moneda,
    proveedor: p.proveedor,
    producto: p.producto,
    version: p.version,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Historial de precios</h1>
      <p className="text-sm text-slate-600">Solo el comprador ve esta información (costos y proveedores).</p>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Producto (por similitud de nombre, uso o descripción)">
          <Input name="producto" defaultValue={producto} className="w-72" />
        </Field>
        <Field label="Proveedor">
          <Input name="proveedor" list="provs-hist" defaultValue={proveedor} className="w-64" />
          <datalist id="provs-hist">{(sup ?? []).map((s) => <option key={s.nombre} value={s.nombre} />)}</datalist>
        </Field>
        <Button type="submit">Buscar</Button>
      </form>
      {error && <p className="text-sm text-red-700">{error.message}</p>}

      {producto && <CostHistoryChart points={points} />}

      {(producto || proveedor) && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Costo</th>
                <th className="px-3 py-2">Envío</th><th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Precio elegido</th><th className="px-3 py-2">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Sin resultados.</td></tr>}
              {list.map((r) => (
                <tr key={`${r.item_id}-${r.version}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 whitespace-nowrap">{new Date(r.quoted_at).toLocaleDateString("es-MX", { dateStyle: "short" })}</td>
                  <td className="px-3 py-1.5">
                    {r.alt_nombre ? <>Solicitado: {r.producto}<div className="font-medium text-amber-800">Cotizado: {r.alt_nombre}</div></> : r.producto}{" "}
                    <span className="text-slate-400">{r.folio}{r.version > 1 ? ` v${r.version}` : ""}</span>
                    <div className="max-w-xs truncate text-slate-500" title={r.descripcion}>{r.descripcion}</div>
                  </td>
                  <td className="px-3 py-1.5">{r.cliente}</td>
                  <td className="px-3 py-1.5 tabular-nums">${Number(r.costo).toFixed(2)} {r.moneda}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.envio ? `$${Number(r.envio).toFixed(2)}` : "-"}</td>
                  <td className="px-3 py-1.5">{r.proveedor ?? "-"}</td>
                  <td className="px-3 py-1.5">{r.precio_elegido ? `P${r.precio_elegido} ($${Number(r.valor_elegido).toFixed(2)})` : "-"}</td>
                  <td className="px-3 py-1.5">{r.resultado ? RESULT[r.resultado] : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
