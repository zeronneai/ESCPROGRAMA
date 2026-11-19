"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";
import { marcarArticuloPedidoAction } from "@/actions/pegatron";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import type { FilaRecuento } from "@/lib/pegatron-recuento";

const fmt = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 3 });
const fecha = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");

/** Tabla: cuanto se acumula de cada articulo por pedir. El comprador lo marca pedido de un jalon. */
export function RecuentoPegatron({ filas, comprador, linea }: { filas: FilaRecuento[]; comprador: boolean; linea: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  function pedir(f: FilaRecuento) {
    start(async () => {
      const r = await marcarArticuloPedidoAction(f.lineas);
      if (!r.ok) return toast(r.error, "error");
      toast(`Marcado como pedido: ${f.articulo} (${f.lineas.length} renglón${f.lineas.length > 1 ? "es" : ""})`, "success");
      router.refresh();
    });
  }
  if (!filas.length) return <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">✓ No hay artículos por pedir en esta sección.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Artículo</th>
            <th className="px-3 py-2 text-right">Total por pedir</th>
            <th className="px-3 py-2 text-left">Órdenes</th>
            <th className="px-3 py-2 text-left">Entrega más próxima</th>
            {comprador && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave ?? f.articulo} className="border-t border-slate-100 align-top">
              <td className="max-w-[340px] px-3 py-2">
                <p className="font-medium text-slate-900">{f.articulo}</p>
                {linea && !f.clave && <p className="text-[11px] text-amber-700">Sin clave ESC-: no se puede sumar en planeación</p>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-brand-800">
                {f.cantidades.map((c) => <span key={c.unidad} className="block">{fmt(c.total)} <span className="text-xs font-medium text-slate-500">{c.unidad}</span></span>)}
              </td>
              <td className="px-3 py-2 text-xs">
                {f.ocs.map((o) => <Link key={o.id} href={`/pedidos-pegatron/${o.id}`} className="mr-2 inline-block text-brand-700 underline">{o.po}</Link>)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fecha(f.entrega)}</td>
              {comprador && (
                <td className="px-3 py-2 text-right">
                  <Button type="button" variant="secondary" loading={pend} onClick={() => pedir(f)}>Ya lo pedí</Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
