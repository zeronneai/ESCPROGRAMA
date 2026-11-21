import Link from "next/link";
import { DateTime } from "luxon";
import { FacturaForm } from "@/components/almacen/factura-form";
import { PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { almacenVentasActivo } from "@/lib/almacen-ventas";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function VentaConFactura({ searchParams }: { searchParams: Promise<{ cliente?: string; por?: string }> }) {
  const u = await requireRoles(["vendedor", "jefe_ventas"]);
  const { cliente, por } = await searchParams;
  const supabase = await createClient();
  const [cfg, almacen] = await Promise.all([getBusinessSettings(supabase), almacenVentasActivo(supabase)]);
  // La jefa elige a nombre de que vendedor se registra la venta.
  const jefa = u.rol === "jefe_ventas";
  const { data: vendedores } = jefa ? await supabase.from("profiles").select("id, nombre").eq("rol", "vendedor").eq("activo", true).order("nombre") : { data: null };
  const porVendedor = jefa && por ? ((vendedores ?? []) as { id: string; nombre: string }[]).find((x) => x.id === por) ?? null : null;
  const { data: c } = cliente && /^[0-9a-f-]{36}$/i.test(cliente) ? await supabase.from("customers").select("id, nombre").eq("id", cliente).maybeSingle() : { data: null };
  return (
    <div className="space-y-4">
      <Link href="/vendedor/bitacora" className="text-sm text-slate-500 hover:text-slate-800">← Ventas diarias</Link>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/vendedor/bitacora/venta/nueva${c ? `?cliente=${c.id}` : ""}`} className="text-brand-700 underline">No tengo la factura: venta sin factura</Link>
      </div>
      <PageHeader
        title="Registrar venta con factura"
        subtitle={`Sube la factura: se registra la venta (fecha, total, contado o crédito) y se da de alta o completa el cliente${almacen ? " y, si lleva artículos, se manda a almacén para cargar" : ""}.`}
      />
      {jefa && (
        <form method="get" className={`flex flex-wrap items-end gap-3 rounded-xl border-2 p-4 ${porVendedor ? "border-violet-500 bg-violet-50" : "border-slate-200 bg-white"}`}>
          {cliente && <input type="hidden" name="cliente" value={cliente} />}
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-800">
            ¿A nombre de quién se registra la venta?
            <select name="por" defaultValue={porVendedor?.id ?? ""} className="min-w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              <option value="">A mi nombre</option>
              {((vendedores ?? []) as { id: string; nombre: string }[]).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </label>
          <button className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white">Elegir</button>
          {porVendedor && <p className="w-full text-sm font-semibold text-violet-900">La venta va a contar para {porVendedor.nombre} (en sus ventas y su prospección). Le llega un aviso.</p>}
        </form>
      )}
      <FacturaForm key={porVendedor?.id ?? "yo"} por={porVendedor} modo="venta" almacen={almacen} cliente={c ?? null} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
    </div>
  );
}
