import { EmptyState, PageHeader } from "@/components/ui";
import { AsistenteCompras } from "@/components/planeacion/asistente";
import { MODELO, PRECIO_MTOK } from "@/lib/asistente-compras";
import { requireBuyer } from "@/lib/auth/guards";
import { fmtNum } from "@/lib/planeacion";
import { hoyMx } from "@/lib/planeacion-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Asistente de compras con Claude (solo comprador). */
export default async function AsistentePage() {
  await requireBuyer();
  const supabase = await createClient();
  const hoy = hoyMx();
  const [{ data: reg, error }, { data: uso }] = await Promise.all([
    supabase.from("plan_asistente").select("reglas").eq("id", 1).maybeSingle(),
    supabase.from("plan_asistente_uso").select("modelo, entrada, salida").gte("created_at", `${hoy.slice(0, 8)}01`).limit(5000),
  ]);
  if (error)
    return (
      <div className="space-y-4">
        <PageHeader title="Asistente de compras" />
        <EmptyState title="Falta la actualización de la base">Corre <code>0078_pedidos_vendedores.sql</code> en el SQL Editor de Supabase.</EmptyState>
      </div>
    );
  let usd = 0;
  for (const u of uso ?? []) {
    const [pe, ps] = PRECIO_MTOK[u.modelo as string] ?? PRECIO_MTOK["claude-sonnet-5-5"];
    usd += (Number(u.entrada) * pe + Number(u.salida) * ps) / 1e6;
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title="Asistente de compras"
        subtitle={
          <>
            Claude con los datos de tu planeación: existencias, venta real, OCs y pedidos de vendedores. Pídele planes de OCs con tus reglas o pregúntale lo que necesites.
            <span className="mt-1 block text-xs text-slate-500">
              Este mes: {(uso ?? []).length} consultas, aprox. ${fmtNum(usd, 2)} USD de uso de Claude ({MODELO}).
            </span>
          </>
        }
      />
      <AsistenteCompras reglasIniciales={(reg?.reglas as string | undefined) ?? ""} hoy={hoy} configurado={!!process.env.ANTHROPIC_API_KEY} />
    </div>
  );
}
