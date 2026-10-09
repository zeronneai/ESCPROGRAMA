import { requireBuyer } from "@/lib/auth/guards";
import { getCompanyProfile } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { ConfigPanel } from "./config-panel";

export default async function Configuracion() {
  await requireBuyer();
  const supabase = await createClient();
  const [{ data: history }, { data: settings }, { data: holidays }, company] = await Promise.all([
    supabase
      .from("pricing_config")
      .select("id, no_shipping_markup, p1, p2, p3, p4, p5, created_at, profiles:created_by(nombre)")
      .order("id", { ascending: false })
      .limit(20),
    supabase.from("app_settings").select("timezone, sla_business_hours, warn_business_hours, vigencia_dias").single(),
    supabase.from("holidays").select("fecha, descripcion").order("fecha"),
    getCompanyProfile(supabase),
  ]);
  return (
    <ConfigPanel
      history={(history ?? []) as unknown as Parameters<typeof ConfigPanel>[0]["history"]}
      settings={settings!}
      holidays={holidays ?? []}
      company={company}
    />
  );
}
