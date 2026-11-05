import Link from "next/link";
import { Icon } from "@/components/icons";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { RECEPCION_COLS, TIPOS_RECEPCION, type RecepcionRow } from "@/lib/almacen";
import { fmtDay } from "@/lib/ops/server";
import { createClient } from "@/lib/supabase/server";

export default async function Recepciones() {
  const u = await requireUser();
  const supabase = await createClient();
  const [{ data }, { data: lin }] = await Promise.all([
    supabase.from("recepciones").select(RECEPCION_COLS).order("created_at", { ascending: false }).limit(300),
    supabase.from("recepcion_lineas").select("recepcion_id, cantidad").limit(20000),
  ]);
  const rows = (data ?? []) as RecepcionRow[];
  const tot = new Map<string, { n: number; arts: number }>();
  for (const l of lin ?? []) {
    const t = tot.get(l.recepcion_id) ?? { n: 0, arts: 0 };
    t.n += l.cantidad;
    t.arts += 1;
    tot.set(l.recepcion_id, t);
  }
  const alm = u.rol === "almacen" || u.rol === "supervisor_almacen";
  return (
    <div className="space-y-5">
      <PageHeader
        title="Recepciones"
        subtitle="Lo que llega al almacén. Cada recepción genera sus etiquetas con QR para el inventario."
        actions={alm ? (
          <Link href="/almacen/recepciones/nueva" className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Icon name="plus" className="h-4 w-4" /> Nueva recepción
          </Link>
        ) : undefined}
      />
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="Aún no hay recepciones">{alm && "Registra la primera con Nueva recepción. Para lo que ya está en el almacén usa \"Inventario inicial\"."}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/almacen/recepciones/${r.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      <span className="font-mono">{r.folio}</span>
                      <Chip cls="bg-slate-100 text-slate-700">{TIPOS_RECEPCION[r.tipo].split(" (")[0]}</Chip>
                      {r.proveedor && <span className="truncate font-normal text-slate-600">{r.proveedor}</span>}
                    </p>
                    <p className="text-xs text-slate-500">{fmtDay(r.fecha)}{r.orden_compra ? ` · OC ${r.orden_compra}` : ""} · {r.autor_nombre}</p>
                  </div>
                  <span className="text-sm text-slate-700">{tot.get(r.id)?.n ?? 0} etiqueta(s) · {tot.get(r.id)?.arts ?? 0} artículo(s)</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
