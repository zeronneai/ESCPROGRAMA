import { ClientsDirectory } from "@/components/customers";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

/** Vendedor: solo buscador (no ve la lista completa de clientes). */
export default async function ClientesVendedor({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  await requireUser();
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data } = editar && /^[0-9a-f-]{36}$/i.test(editar)
    ? await supabase.from("customers").select(CUSTOMER_COLS).eq("id", editar).maybeSingle()
    : { data: null };
  return <ClientsDirectory customers={[]} role="vendedor" editCustomer={(data as CustomerRecord | null) ?? null} />;
}
