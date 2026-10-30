import { ClientsDirectory } from "@/components/customers";
import { requireSalesViewer } from "@/lib/auth/sales";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

export default async function ClientesVentas({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const u = await requireSalesViewer();
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select(CUSTOMER_COLS).order("nombre");
  const list = (data ?? []) as CustomerRecord[];
  return <ClientsDirectory customers={list} role={u.rol === "comprador" ? "comprador" : "jefe_ventas"} editCustomer={list.find((c) => c.id === editar) ?? null} />;
}
