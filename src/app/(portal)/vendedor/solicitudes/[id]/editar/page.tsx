import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";
import { notFound, redirect } from "next/navigation";
import { RequestEditor } from "@/components/request-editor";
import { requireUser } from "@/lib/auth/guards";
import { withSignedUrls } from "@/lib/quotes/server";
import type { ReferenceRow } from "@/lib/quotes/types";
import { createClient } from "@/lib/supabase/server";

export default async function EditarBorrador({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("quote_requests")
    .select("id, customer_id, notas, atencion, destino_entrega, estado, vendedor_id, archived_at")
    .eq("id", id)
    .maybeSingle();
  if (!req || req.vendedor_id !== user.id || req.archived_at) notFound();
  if (req.estado !== "borrador") redirect(`/vendedor/solicitudes/${id}`);

  const [{ data: customer }, { data: items }] = await Promise.all([
    supabase.from("customers").select(CUSTOMER_COLS).eq("id", req.customer_id).maybeSingle(),
    supabase
      .from("quote_items")
      .select("id, posicion, producto, descripcion, cantidad, unidad, talla, notas, item_references(id, tipo, url)")
      .eq("request_id", id)
      .order("posicion"),
  ]);
  const withUrls = await withSignedUrls(
    supabase,
    (items ?? []).map((i) => ({ ...i, item_references: i.item_references as ReferenceRow[] })),
  );
  const previews: Record<string, string> = {};
  for (const it of withUrls) for (const r of it.item_references) if (r.signedUrl) previews[r.id] = r.signedUrl;

  return (
    <RequestEditor
      customer={(customer as CustomerRecord | null) ?? null}
      initial={{
        request_id: id,
        customer_id: req.customer_id,
        notas: req.notas ?? "",
        atencion: req.atencion ?? "",
        destino_entrega: req.destino_entrega ?? "",
        saved: true,
        previews,
        items: withUrls.map((i) => ({
          id: i.id,
          producto: i.producto,
          descripcion: i.descripcion,
          cantidad: i.cantidad === null ? "" : String(Number(i.cantidad)),
          unidad: i.unidad ?? "pieza",
          talla: i.talla ?? "",
          notas: i.notas ?? "",
          refs: i.item_references.map((r) => ({ id: r.id, tipo: r.tipo, url: r.url })),
        })),
      }}
    />
  );
}
