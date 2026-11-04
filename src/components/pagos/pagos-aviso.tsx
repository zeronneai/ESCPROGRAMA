import { DateTime } from "luxon";
import { PagosPopup } from "@/components/pagos/pagos-popup";
import { fmtTotales, totalesPorMoneda } from "@/lib/pagos";
import { createClient } from "@/lib/supabase/server";

/** Calcula el aviso de pagos para el CEO o el comprador (servidor). */
export async function PagosAviso({ rol }: { rol: string }) {
  if (rol !== "ceo" && rol !== "comprador") return null;
  const supabase = await createClient();
  const estado = rol === "ceo" ? "pendiente" : "pagado";
  const { data } = await supabase.from("pagos").select("id, monto, fecha_limite, urgente, carga, ordenes_compra(moneda)").eq("estado", estado).limit(1000);
  const rows = (data ?? []) as unknown as { id: string; monto: number | null; fecha_limite: string | null; urgente: boolean; carga: string; ordenes_compra: { moneda: string } | null }[];
  if (!rows.length) return null;
  const hoy = DateTime.now().setZone("America/Chihuahua").toISODate()!;
  const total = fmtTotales(totalesPorMoneda(rows.map((r) => ({ monto: r.monto, moneda: r.ordenes_compra?.moneda ?? "USD" }))));
  const vencidos = rows.filter((r) => r.fecha_limite && r.fecha_limite < hoy).length;
  const clave = `${rol}:${rows.map((r) => `${r.id}${r.urgente ? "!" : ""}`).sort().join(",").slice(0, 400)}`;
  return rol === "ceo" ? (
    <PagosPopup
      clave={clave}
      titulo={`Tienes ${rows.length} pago(s) pendiente(s)`}
      lineas={[`Total por pagar: ${total}`, ...(rows.some((r) => r.urgente) ? [`${rows.filter((r) => r.urgente).length} marcado(s) URGENTE por compras`] : []), ...(vencidos ? [`${vencidos} con fecha límite vencida`] : []), ...(rows.some((r) => r.carga === "sin_liberar") ? [`${rows.filter((r) => r.carga === "sin_liberar").length} con la carga sin liberar`] : [])]}
      cta="Ver pagos"
    />
  ) : (
    <PagosPopup clave={clave} titulo={`${rows.length} comprobante(s) de pago por descargar`} lineas={["El CEO ya pagó. Descarga el comprobante y mándalo al proveedor."]} cta="Ver comprobantes" />
  );
}
