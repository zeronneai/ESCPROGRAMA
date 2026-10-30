import { RequestEditor } from "@/components/request-editor";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

export default async function NuevaSolicitud({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  await requireUser();
  const { cliente } = await searchParams;
  const supabase = await createClient();
  // Desde la bitacora: precarga el cliente (solo si el vendedor puede verlo).
  const { data: preset } = cliente && /^[0-9a-f-]{36}$/i.test(cliente)
    ? await supabase.from("customers").select(CUSTOMER_COLS).eq("id", cliente).eq("activo", true).maybeSingle()
    : { data: null };
  const c = (preset as CustomerRecord | null) ?? null;
  return (
    <RequestEditor
      customer={c}
      initial={{ request_id: crypto.randomUUID(), customer_id: c?.id ?? "", notas: "", atencion: "", destino_entrega: "", items: [], previews: {}, saved: false }}
    />
  );
}
