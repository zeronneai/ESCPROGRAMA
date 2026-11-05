import Link from "next/link";
import { ConsultarEtiqueta } from "@/components/almacen/consultar-etiqueta";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { fmtDay } from "@/lib/ops/server";
import { createClient } from "@/lib/supabase/server";

type Inv = { articulo_id: string; clave: string; nombre: string; familia: string; en_almacen: number; cargadas: number; bajas: number; primera: string | null; ultima: string | null };
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default async function Inventario({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inventario_resumen");
  const all = ((data ?? []) as Inv[]).map((r) => ({ ...r, en_almacen: Number(r.en_almacen), cargadas: Number(r.cargadas), bajas: Number(r.bajas) }));
  const q = norm(sp.q ?? "").trim();
  const conExistencia = sp.ver !== "todos";
  const rows = all
    .filter((r) => (conExistencia ? r.en_almacen > 0 : true))
    .filter((r) => !q || q.split(/\s+/).every((w) => norm(`${r.clave} ${r.nombre} ${r.familia}`).includes(w)))
    .sort((a, b) => a.clave.localeCompare(b.clave));
  const piezas = all.reduce((a, r) => a + r.en_almacen, 0);
  const alm = u.rol === "almacen" || u.rol === "supervisor_almacen";
  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventario"
        subtitle="Existencias según las etiquetas: cada etiqueta en almacén es una unidad. Sale al escanearla en la carga de una factura."
        actions={alm ? (
          <Link href="/almacen/recepciones/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nueva recepción
          </Link>
        ) : undefined}
      />
      {error && <Card className="border-red-200 bg-red-50 text-sm text-red-800">No se pudo cargar: {error.message}</Card>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Unidades en almacén" value={piezas.toLocaleString("es-MX")} />
        <StatCard label="Artículos con existencia" value={all.filter((r) => r.en_almacen > 0).length} />
        <StatCard label="Unidades que han salido" value={all.reduce((a, r) => a + r.cargadas, 0).toLocaleString("es-MX")} />
      </div>
      <Card className="space-y-2 p-4">
        <p className="text-sm font-semibold text-slate-800">Consultar una etiqueta</p>
        <ConsultarEtiqueta />
      </Card>
      <form className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por clave o nombre" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:max-w-sm" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="ver" value="todos" defaultChecked={!conExistencia} /> Incluir artículos sin existencia
        </label>
        <button className="rounded-md bg-slate-800 px-3 py-2 text-sm text-white">Buscar</button>
      </form>
      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <EmptyState title={all.length ? "Sin resultados" : "Aún no hay inventario"}>{!all.length && "Se arma con las recepciones: registra el inventario inicial y lo que vaya llegando."}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">Artículo</th><th className="px-3 py-2 text-right">En almacén</th><th className="hidden px-3 py-2 text-right sm:table-cell">Salieron</th><th className="hidden px-3 py-2 md:table-cell">Más antiguo</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.articulo_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/almacen/inventario/${r.articulo_id}`} className="block">
                      <span className="font-mono text-xs text-slate-500">{r.clave}</span>
                      <span className="block text-slate-900">{r.nombre}</span>
                    </Link>
                  </td>
                  <td className={`px-3 py-2 text-right text-base font-semibold ${r.en_almacen ? "text-slate-900" : "text-red-700"}`}>{r.en_almacen}</td>
                  <td className="hidden px-3 py-2 text-right text-slate-600 sm:table-cell">{r.cargadas}</td>
                  <td className="hidden px-3 py-2 text-slate-600 md:table-cell">{fmtDay(r.primera)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
