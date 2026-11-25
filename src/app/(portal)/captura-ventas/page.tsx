import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { CancelarCaptura, CapturarVenta } from "@/components/metas/capturar";
import { requireRoles } from "@/lib/auth/sales";
import { hoyMx } from "@/lib/planeacion-server";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/ventas";

export const dynamic = "force-dynamic";

type Cap = { id: string; meta_id: string; fecha: string; folio: string | null; cliente: string | null; subtotal: string; moneda: "MXN" | "USD"; tipo_cambio: string | null; nota: string | null; cancelada_at: string | null; profiles: { nombre: string } | null };

/** Capturar a mano las ventas de una meta sin usuario (ej. Jose Ortiz). */
export default async function CapturarPage() {
  const u = await requireRoles(["vendedor", "jefe_ventas", "marketplaces"]);
  const supabase = await createClient();
  const hoy = hoyMx();
  let q = supabase.from("metas_venta").select("id, nombre").is("vendedor_id", null).eq("estado", "activa").order("orden");
  if (u.rol !== "jefe_ventas") q = q.eq("capturista_id", u.id);
  const { data: metas, error } = await q;
  const ms = (metas ?? []) as { id: string; nombre: string }[];
  const desde = `${hoy.slice(0, 8)}01`;
  const { data: caps } = ms.length
    ? await supabase.from("metas_venta_capturas").select("id, meta_id, fecha, folio, cliente, subtotal, moneda, tipo_cambio, nota, cancelada_at, profiles(nombre)").in("meta_id", ms.map((m) => m.id)).gte("fecha", desde).order("fecha", { ascending: false }).order("created_at", { ascending: false })
    : { data: [] };
  const lista = (caps ?? []) as unknown as Cap[];

  return (
    <div className="space-y-5">
      <PageHeader title="Sumar ventas" subtitle="Lo vendido por quien no tiene usuario en el portal (José Ortiz). Solo pon la cantidad en pesos sin IVA: suma al momento en las gráficas de Metas." />
      <Link href="/metas" className="text-sm font-medium text-brand-700 underline">Ver gráficas de metas →</Link>
      {error ? (
        <EmptyState title="Falta la actualización de la base">Corre <code>0080_metas_ventas.sql</code> en el SQL Editor de Supabase.</EmptyState>
      ) : !ms.length ? (
        <EmptyState title="No tienes metas para capturar">La jefa de ventas elige quién captura las ventas de cada meta sin usuario (en Configurar metas).</EmptyState>
      ) : (
        <>
          <CapturarVenta metas={ms} hoy={hoy} />
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Sumado este mes{lista.length ? `: ${money(lista.filter((c) => !c.cancelada_at).reduce((a, c) => a + Number(c.subtotal), 0))}` : ""}</h2>
            {lista.length ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {lista.map((c) => (
                  <li key={c.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${c.cancelada_at ? "opacity-50" : ""}`}>
                    <div className="min-w-0">
                      <p className="font-medium">{money(Number(c.subtotal), c.moneda)} <span className="text-xs font-normal text-slate-500">sin IVA{c.moneda === "USD" && c.tipo_cambio ? ` · TC ${Number(c.tipo_cambio)}` : ""}</span></p>
                      <p className="text-xs text-slate-500">
                        {ms.length > 1 ? `${ms.find((m) => m.id === c.meta_id)?.nombre} · ` : ""}{c.fecha}{c.folio ? ` · Factura ${c.folio}` : ""}{c.cliente ? ` · ${c.cliente}` : ""}{c.profiles?.nombre ? ` · capturó ${c.profiles.nombre}` : ""}
                      </p>
                      {c.nota && <p className="text-xs text-slate-500">{c.nota}</p>}
                    </div>
                    {c.cancelada_at ? <span className="text-xs text-slate-500">Cancelada</span> : <CancelarCaptura id={c.id} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Todavía no hay ventas capturadas este mes.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
