import { ClientsDirectory } from "@/components/customers";
import { requireBuyer } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

export default async function Clientes({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  await requireBuyer();
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select(CUSTOMER_COLS).order("nombre");
  return <ClientsDirectory customers={(data ?? []) as CustomerRecord[]} isBuyer editId={editar} />;
}
