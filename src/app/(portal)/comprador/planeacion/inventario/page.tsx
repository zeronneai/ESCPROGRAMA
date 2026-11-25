import Link from "next/link";
import { InventarioLista, type ArtInv, type SinDescontar, type VentaInv } from "@/components/planeacion/inventario-lista";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { fechaCortaMx } from "@/lib/planeacion";
import { cargarPlaneacion } from "@/lib/planeacion-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Inventario por articulo (comprador): kardex al corte, ventas del portal que lo descontaron y lo recibido. */
export default async function InventarioPlaneacion() {
  await requireBuyer();
  const supabase = await createClient();
  let datos;
  try {
    datos = await cargarPlaneacion(supabase);
  } catch (e) {
    return <EmptyState title="Falta la actualización de la base">{String((e as Error).message).slice(0, 160)}</EmptyState>;
  }
  const { articulos, proveedores, corte } = datos;
  const provNombre = new Map(proveedores.map((p) => [p.id, p.nombre]));
  const claves = new Set(articulos.map((a) => a.clave));

  // Renglones de venta desde el corte: los que tienen clave del kardex descuentan; los demas no.
  const porClave = new Map<string, VentaInv[]>();
  const sinDescontar: SinDescontar[] = [];
  if (corte) {
    type R = { cantidad: string | null; descripcion: string; articulos: { clave: string } | null; ventas: { id: string; fecha: string; factura: string | null; tipo: string; cancelada_at: string | null; vendedor_id: string; customers: { nombre: string } | null } | null };
    const filas: R[] = [];
    for (let i = 0; i < 50; i++) {
      const { data, error } = await supabase
        .from("venta_lineas")
        .select("cantidad, descripcion, articulos(clave), ventas!inner(id, fecha, factura, tipo, cancelada_at, vendedor_id, customers(nombre))")
        .gt("ventas.fecha", corte)
        .order("created_at", { ascending: false })
        .range(i * 1000, i * 1000 + 999);
      if (error) break;
      filas.push(...((data ?? []) as unknown as R[]));
      if (!data || data.length < 1000) break;
    }
    const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("rol", ["vendedor", "jefe_ventas"]);
    const vend = new Map((perfiles ?? []).map((p) => [p.id as string, p.nombre as string]));
    for (const r of filas) {
      const v = r.ventas;
      if (!v || v.cancelada_at || v.tipo !== "venta" || !r.cantidad) continue;
      const base = { fecha: v.fecha, factura: v.factura, cliente: v.customers?.nombre ?? "Cliente", vendedor: vend.get(v.vendedor_id) ?? "", cantidad: Number(r.cantidad), venta_id: v.id };
      const clave = r.articulos?.clave ?? null;
      if (clave && claves.has(clave)) {
        const l = porClave.get(clave) ?? [];
        l.push(base);
        porClave.set(clave, l);
      } else {
        sinDescontar.push({ ...base, descripcion: r.descripcion, clave, motivo: clave ? "La clave no está en la planeación (kárdex)" : "La clave de la factura no existe en el catálogo" });
      }
    }
  }
  const lista: ArtInv[] = articulos.map((a) => ({
    clave: a.clave,
    nombre: a.nombre,
    proveedor: provNombre.get(a.proveedor_id) ?? "",
    um: a.um,
    corte: a.existencia_corte,
    vendido: a.ventas_portal,
    recibido: a.recibido_post,
    existencia: a.existencia,
    ventas: (porClave.get(a.clave) ?? []).sort((x, y) => y.fecha.localeCompare(x.fecha)),
  }));
  const vendidos = lista.filter((a) => a.ventas.length).length;
  const piezas = lista.reduce((s, a) => s + a.vendido, 0);

  return (
    <div className="space-y-4">
      <Link href="/comprador/planeacion" className="text-sm text-slate-500 hover:text-slate-800">← Planeación de compras</Link>
      <PageHeader
        title="Inventario por artículo"
        subtitle={`Existencia del kárdex al ${corte ? fechaCortaMx(corte) : "?"}, menos lo que se ha vendido en el portal desde entonces, más lo recibido. Da clic en un artículo para ver las ventas que lo descontaron.`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Artículos" value={lista.length} />
        <StatCard label="Con ventas desde el corte" value={vendidos} hint={`${piezas.toLocaleString("es-MX")} pzas descontadas`} />
        <StatCard label="Sin existencia" value={lista.filter((a) => a.existencia <= 0).length} tone="amber" />
        <StatCard label="Ventas sin descontar" value={sinDescontar.length} tone={sinDescontar.length ? "red" : "green"} hint="Renglones que no se ligaron a una clave" />
      </div>
      {!articulos.length ? <EmptyState title="Todavía no hay datos">Corre la carga inicial de planeación.</EmptyState> : <InventarioLista articulos={lista} sinDescontar={sinDescontar} />}
    </div>
  );
}
