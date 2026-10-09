import { requireBuyer } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ClientsPanel } from "./clients-panel";

export default async function Clientes() {
  await requireBuyer();
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id, nombre, activo").order("nombre");
  return <ClientsPanel customers={(data ?? []) as Parameters<typeof ClientsPanel>[0]["customers"]} />;
}
