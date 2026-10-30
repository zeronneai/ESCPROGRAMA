import Link from "next/link";
import { DateTime } from "luxon";
import { BitacoraEditor } from "@/components/bitacora-editor";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

export default async function NuevoRegistro({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const tipo = sp.tipo === "prospecto" ? "prospecto" : "cliente";
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  let customer: CustomerRecord | null = null;
  if (sp.cliente && /^[0-9a-f-]{36}$/i.test(sp.cliente)) {
    const { data } = await supabase.from("customers").select(CUSTOMER_COLS).eq("id", sp.cliente).maybeSingle();
    customer = (data as CustomerRecord | null) ?? null;
  }
  return (
    <div className="space-y-4">
      <Link href={`/vendedor/bitacora${tipo === "prospecto" ? "?tab=prospeccion" : ""}`} className="text-sm text-slate-500 hover:text-slate-800">← Bitácora</Link>
      <PageHeader
        title={tipo === "prospecto" ? "Nuevo prospecto" : "Nuevo registro de venta"}
        subtitle="Busca al cliente o dalo de alta. Si ya está registrado, sus datos se llenan solos."
      />
      <BitacoraEditor mode="new" entry={null} customer={customer} requests={[]} events={[]} today={DateTime.now().setZone(cfg.timezone).toISODate()!} timezone={cfg.timezone} defaultKind={tipo} />
    </div>
  );
}
