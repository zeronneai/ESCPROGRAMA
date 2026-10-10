import { RequestEditor } from "@/components/request-editor";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export default async function NuevaSolicitud() {
  await requireUser();
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");
  return (
    <RequestEditor
      customers={customers ?? []}
      initial={{ request_id: crypto.randomUUID(), customer_id: "", notas: "", atencion: "", destino_entrega: "", items: [], previews: {}, saved: false }}
    />
  );
}
