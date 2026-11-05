import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip, Dl } from "@/components/ops-ui";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ESTADO_ETIQUETA, RECEPCION_COLS, TIPOS_RECEPCION, type RecepcionRow } from "@/lib/almacen";
import { fmtDate, fmtDay } from "@/lib/ops/server";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

type Lin = { id: string; cantidad: number; lote: string | null; articulos: { clave: string; nombre: string } | null };

export default async function Recepcion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const [{ data: r }, { data: lin }, { data: ets }] = await Promise.all([
    supabase.from("recepciones").select(RECEPCION_COLS).eq("id", id).maybeSingle(),
    supabase.from("recepcion_lineas").select("id, cantidad, lote, articulos(clave, nombre)").eq("recepcion_id", id).order("created_at"),
    supabase.from("etiquetas").select("codigo, linea_id, estado").eq("recepcion_id", id).order("codigo"),
  ]);
  if (!r) notFound();
  const rec = r as RecepcionRow;
  const lineas = (lin ?? []) as unknown as Lin[];
  const etiquetas = (ets ?? []) as { codigo: string; linea_id: string; estado: keyof typeof ESTADO_ETIQUETA }[];
  const imp = (q: string) => `/imprimir/etiquetas?${q}`;
  return (
    <div className="space-y-4">
      <Link href="/almacen/recepciones" className="text-sm text-slate-500 hover:text-slate-800">← Recepciones</Link>
      <PageHeader
        title={`Recepción ${rec.folio}`}
        subtitle={TIPOS_RECEPCION[rec.tipo]}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={imp(`recepcion=${id}&formato=carta`)} target="_blank" rel="noreferrer" className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">Imprimir etiquetas (hoja carta)</a>
            <a href={imp(`recepcion=${id}&formato=50x25`)} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Etiquetadora</a>
          </div>
        }
      />
      {sp.nueva && <Alert tone="success">Recepción guardada con {etiquetas.length} etiqueta(s). Imprímelas y pega una en cada caja.</Alert>}
      <Card className="p-4">
        <Dl
          items={[
            ["Fecha de recepción", fmtDay(rec.fecha)],
            ["Orden de compra", rec.orden_compra ?? ""],
            ["Proveedor", rec.proveedor ?? ""],
            ["Registró", `${rec.autor_nombre ?? ""} · ${fmtDate(rec.created_at, cfg.timezone)}`],
            ["Notas", rec.notas ?? ""],
          ]}
        />
      </Card>
      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {lineas.map((l) => {
            const mias = etiquetas.filter((e) => e.linea_id === l.id);
            return (
              <li key={l.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-500">{l.articulos?.clave}{l.lote ? ` · Lote ${l.lote}` : ""}</p>
                    <p className="text-sm font-medium text-slate-900">{l.articulos?.nombre}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-sm">
                    <span className="font-semibold">{l.cantidad} etiqueta(s)</span>
                    <a href={imp(`linea=${l.id}&formato=carta`)} target="_blank" rel="noreferrer" className="text-xs text-brand-700 underline">Imprimir solo estas</a>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {mias.map((e) => (
                    <Link key={e.codigo} href={`/almacen/etiqueta/${e.codigo}`} className="hover:opacity-80">
                      <Chip cls={ESTADO_ETIQUETA[e.estado].cls}><span className="font-mono">{e.codigo}</span></Chip>
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
