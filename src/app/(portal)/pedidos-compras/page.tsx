import { EmptyState, PageHeader } from "@/components/ui";
import { CancelarPedido, PedirArticulo } from "@/components/pedidos/pedir";
import { requireRoles } from "@/lib/auth/sales";
import { FRECUENCIA_CORTA, type EstadoPedido, type Frecuencia } from "@/lib/pedidos";
import { fechaCortaMx, fmtNum } from "@/lib/planeacion";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Mio = {
  id: string; clave: string | null; descripcion: string; cantidad: number; um: string | null; frecuencia: Frecuencia; cliente: string | null; notas: string | null;
  estado: EstadoPedido; oc_folio: string | null; oc_estado: string | null; llegada_estimada: string | null; recibida_fecha: string | null; pedido_at: string | null;
  nota_comprador: string | null; created_at: string;
};

const OC_TXT: Record<string, string> = { borrador: "En preparación", enviada: "Enviada al proveedor", proforma: "Confirmada por el proveedor", embarcada: "En camino", recibida: "Ya llegó", cancelada: "Cancelada" };

/** Pedidos al comprador: los vendedores (y jefa, gerente y CEO) piden articulos y ven en que OC van. */
export default async function PedidosCompras() {
  await requireRoles(["vendedor", "jefe_ventas", "gerente", "ceo"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pedidos_vendedor_mios");
  const mios = (data ?? []) as Mio[];
  const activos = mios.filter((m) => m.estado === "activo");
  const atendidos = mios.filter((m) => m.estado !== "activo");

  const Fila = ({ m }: { m: Mio }) => (
    <li className="space-y-1 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{m.clave ? `${m.clave} · ` : <span className="mr-1 rounded bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-800">OTRO</span>}{m.descripcion}</p>
          <p className="text-xs text-slate-500">
            {fmtNum(m.cantidad, 2)} {m.um?.toLowerCase() ?? ""} · {FRECUENCIA_CORTA[m.frecuencia]}{m.cliente ? ` · ${m.cliente}` : ""} · pedido el {fechaCortaMx(m.created_at)}
          </p>
          {m.notas && <p className="text-xs text-slate-500">Nota: {m.notas}</p>}
        </div>
        {m.estado === "activo" ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{m.frecuencia === "unica" ? "Esperando OC" : "Activo"}</span>
            <CancelarPedido id={m.id} />
          </div>
        ) : m.estado === "pedido" ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Pedido{m.oc_folio ? ` en ${m.oc_folio}` : ""}</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Cancelado</span>
        )}
      </div>
      {m.estado === "pedido" && m.oc_estado && (
        <p className="text-sm text-slate-700">
          {OC_TXT[m.oc_estado] ?? m.oc_estado}
          {m.oc_estado === "recibida" ? (m.recibida_fecha ? ` el ${fechaCortaMx(m.recibida_fecha)}` : "") : m.llegada_estimada ? ` · llega aprox. ${fechaCortaMx(m.llegada_estimada)}` : ""}
        </p>
      )}
      {m.nota_comprador && <p className="rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">Comprador: {m.nota_comprador}</p>}
    </li>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Pedir al comprador" subtitle="¿Necesitas algo que no hay o que se va a vender más? Pídelo aquí y el comprador lo toma en cuenta en su próxima orden de compra." />
      {error ? (
        <EmptyState title="Falta la actualización de la base">Corre <code>0078_pedidos_vendedores.sql</code> en el SQL Editor de Supabase.</EmptyState>
      ) : (
        <>
          <PedirArticulo />
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Mis pedidos activos ({activos.length})</h2>
            {activos.length ? <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">{activos.map((m) => <Fila key={m.id} m={m} />)}</ul> : <p className="text-sm text-slate-500">No tienes pedidos activos.</p>}
          </section>
          {atendidos.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Ya atendidos</h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">{atendidos.map((m) => <Fila key={m.id} m={m} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
