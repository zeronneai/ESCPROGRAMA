import { ClientsDirectory } from "@/components/customers";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

export default async function ClientesVendedor({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  await requireUser();
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select(CUSTOMER_COLS).order("nombre");
  return <ClientsDirectory customers={(data ?? []) as CustomerRecord[]} isBuyer={false} editId={editar} />;
}
