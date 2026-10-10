import Link from "next/link";
import { Card } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

/** Catalogo de proveedores (solo comprador). Se llena solo al cotizar o al anotar abastecimiento. */
export default async function Proveedores() {
  await requireBuyer();
  const supabase = await createClient();
  const [{ data: sup }, { data: costs }] = await Promise.all([
    supabase.from("suppliers").select("id, nombre, activo, created_at").order("nombre"),
    supabase.from("item_costs").select("proveedor").not("proveedor", "is", null),
  ]);
  const counts = new Map<string, number>();
  for (const c of costs ?? []) {
    const k = String(c.proveedor).trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Proveedores</h1>
      <p className="text-sm text-slate-600">Catálogo interno para el autocompletado. Solo el comprador lo ve.</p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr><th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Cotizaciones</th><th className="px-3 py-2">Alta</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {(sup ?? []).length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">Aún no hay proveedores.</td></tr>}
            {(sup ?? []).map((s) => (
              <tr key={s.id} className="border-t border-slate-200">
                <td className="px-3 py-2">{s.nombre}</td>
                <td className="px-3 py-2 tabular-nums">{counts.get(String(s.nombre).trim().toLowerCase()) ?? 0}</td>
                <td className="px-3 py-2">{new Date(s.created_at).toLocaleDateString("es-MX")}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/comprador/historial?proveedor=${encodeURIComponent(s.nombre)}`} className="text-brand-600 hover:underline">Ver historial</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
