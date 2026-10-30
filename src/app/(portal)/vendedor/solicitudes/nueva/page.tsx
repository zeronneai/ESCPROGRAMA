import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";
import { RequestEditor } from "@/components/request-editor";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaSolicitud({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await requireUser();
  const { cliente } = await searchParams;
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select(CUSTOMER_COLS)
    .eq("activo", true)
    .order("nombre");
  // Desde un lead: precarga el cliente vinculado (solo si existe en el catalogo).
  const preset = (customers ?? []).find((c) => c.id === cliente)?.id ?? "";
  return (
    <RequestEditor
      customers={(customers ?? []) as CustomerRecord[]}
      initial={{ request_id: crypto.randomUUID(), customer_id: preset, notas: "", atencion: "", destino_entrega: "", items: [], previews: {}, saved: false }}
    />
  );
}
