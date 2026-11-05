import Link from "next/link";
import { Chip } from "@/components/ops-ui";
import { Alert, Card } from "@/components/ui";
import { ESTADO_SALIDA, type EstadoSalida } from "@/lib/almacen";
import { createClient } from "@/lib/supabase/server";

/** Venta registrada con factura: archivos y como va la entrega en almacen. */
export async function VentaFacturaInfo({ ventaId, nueva }: { ventaId: string; nueva?: boolean }) {
  const supabase = await createClient();
  const [{ data: v }, { data: sal }] = await Promise.all([
    supabase.from("ventas").select("origen, factura, factura_path, xml_path").eq("id", ventaId).maybeSingle(),
    supabase.from("salidas").select("id, estado, espera, espera_nota").eq("venta_id", ventaId).neq("estado", "cancelada").maybeSingle(),
  ]);
  if (!v || v.origen !== "factura") return null;
  const s = sal as { id: string; estado: EstadoSalida; espera: boolean; espera_nota: string | null } | null;
  return (
    <div className="space-y-3">
      {nueva && (
        <Alert tone="success">
          Venta registrada con la factura {v.factura}.{s ? " También se mandó a almacén para cargar." : ""} Cuando te paguen, márcala como cobrada.
        </Alert>
      )}
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <span className="font-medium text-slate-800">Factura {v.factura}</span>
        {v.factura_path && <a href={`/api/ventas/${ventaId}/factura`} target="_blank" rel="noreferrer" className="text-brand-700 underline">Ver PDF</a>}
        {v.xml_path && <a href={`/api/ventas/${ventaId}/factura?tipo=xml`} className="text-brand-700 underline">XML</a>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {s ? (
            <>
              <span className="text-slate-500">Almacén:</span>
              <Chip cls={ESTADO_SALIDA[s.estado].cls}>{ESTADO_SALIDA[s.estado].label}</Chip>
              {s.espera && s.estado !== "cargada" && <Chip cls="bg-orange-100 text-orange-800">Sin material</Chip>}
              <Link href={`/entregas/${s.id}`} className="text-brand-700 underline">Ver entrega</Link>
            </>
          ) : (
            <span className="text-slate-500">Sin artículos para cargar en almacén</span>
          )}
        </span>
      </Card>
      {s?.espera && s.estado !== "cargada" && <Alert tone="error">Almacén no puede surtir por falta de material: {s.espera_nota}</Alert>}
    </div>
  );
}
