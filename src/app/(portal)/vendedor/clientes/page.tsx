import Link from "next/link";
import { ClientsDirectory } from "@/components/customers";
import { requireUser } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, type CustomerRecord } from "@/lib/validation/customer";

/** Vendedor: solo buscador (no ve la lista completa de clientes) y acceso a la evaluacion de clientes. */
export default async function ClientesVendedor({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const u = await requireUser();
  const { editar } = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: per }, { count: pendientes }] = await Promise.all([
    editar && /^[0-9a-f-]{36}$/i.test(editar) ? supabase.from("customers").select(CUSTOMER_COLS).eq("id", editar).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("eval_periodos").select("id, nombre").eq("tipo", "clientes").eq("estado", "activo").maybeSingle(),
    supabase.from("encuestas_cliente").select("id", { count: "exact", head: true }).eq("vendedor_id", u.id).is("respondida_at", null),
  ]);
  return (
    <div className="space-y-4">
      <Link href="/evaluaciones/clientes" className="flex items-center justify-between gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900 hover:bg-brand-100">
        <span>
          <strong>Evaluación de clientes</strong>{" "}
          {per ? `activa (${per.nombre}): genera el link de cada cliente y mándaselo.${pendientes ? ` ${pendientes} sin responder.` : ""}` : ": aquí verás los links y respuestas cuando se active."}
        </span>
        <span className="shrink-0 font-medium underline">Abrir</span>
      </Link>
      <ClientsDirectory customers={[]} role="vendedor" editCustomer={(data as CustomerRecord | null) ?? null} />
    </div>
  );
}
