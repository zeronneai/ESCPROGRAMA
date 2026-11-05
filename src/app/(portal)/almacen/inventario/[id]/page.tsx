import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip } from "@/components/ops-ui";
import { Card, PageHeader, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ESTADO_ETIQUETA } from "@/lib/almacen";
import { fmtDay } from "@/lib/ops/server";
import { createClient } from "@/lib/supabase/server";

type Et = { codigo: string; recibida: string; estado: keyof typeof ESTADO_ETIQUETA; salida_at: string | null; recepciones: { id: string; folio: string } | null; salidas: { id: string; folio_factura: string } | null };

export default async function InventarioArticulo({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: a }, { data }] = await Promise.all([
    supabase.from("articulos").select("id, clave, nombre, familia").eq("id", id).maybeSingle(),
    supabase.from("etiquetas").select("codigo, recibida, estado, salida_at, recepciones(id, folio), salidas!etiquetas_salida_fk(id, folio_factura)").eq("articulo_id", id).order("recibida").order("codigo").limit(5000),
  ]);
  if (!a) notFound();
  const ets = (data ?? []) as unknown as Et[];
  const enAlm = ets.filter((e) => e.estado === "almacen");
  const grupos = new Map<string, { folio: string; recId: string; recibida: string; codigos: string[] }>();
  for (const e of enAlm) {
    const k = e.recepciones?.id ?? "";
    const g = grupos.get(k) ?? { folio: e.recepciones?.folio ?? "", recId: k, recibida: e.recibida, codigos: [] };
    g.codigos.push(e.codigo);
    grupos.set(k, g);
  }
  const salidas = ets.filter((e) => e.estado === "cargada").sort((x, y) => (y.salida_at ?? "").localeCompare(x.salida_at ?? "")).slice(0, 50);
  return (
    <div className="space-y-4">
      <Link href="/almacen/inventario" className="text-sm text-slate-500 hover:text-slate-800">← Inventario</Link>
      <PageHeader title={a.nombre} subtitle={<span className="font-mono">{a.clave}</span>} />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="En almacén" value={enAlm.length} />
        <StatCard label="Salieron" value={ets.filter((e) => e.estado === "cargada").length} />
        <StatCard label="Bajas" value={ets.filter((e) => e.estado === "baja").length} />
      </div>
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">En almacén (primero lo más antiguo)</h2>
        {[...grupos.values()].map((g) => (
          <div key={g.recId} className="space-y-1.5">
            <p className="text-sm text-slate-700">
              <Link href={`/almacen/recepciones/${g.recId}`} className="font-mono text-brand-700 underline">{g.folio}</Link> · recibido {fmtDay(g.recibida)} · <strong>{g.codigos.length}</strong>
            </p>
            <div className="flex flex-wrap gap-1">
              {g.codigos.map((c) => <Link key={c} href={`/almacen/etiqueta/${c}`}><Chip cls="bg-green-100 text-green-800"><span className="font-mono">{c}</span></Chip></Link>)}
            </div>
          </div>
        ))}
        {!enAlm.length && <p className="text-sm text-slate-500">Sin existencias.</p>}
      </Card>
      {salidas.length > 0 && (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Últimas salidas</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {salidas.map((e) => (
              <li key={e.codigo} className="flex justify-between gap-2 py-1.5">
                <Link href={`/almacen/etiqueta/${e.codigo}`} className="font-mono text-brand-700">{e.codigo}</Link>
                <span className="text-slate-600">{e.salidas ? <Link href={`/entregas/${e.salidas.id}`} className="underline">Factura {e.salidas.folio_factura}</Link> : ""} · {fmtDay(e.salida_at?.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
