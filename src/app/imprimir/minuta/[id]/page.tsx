import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/minutas/minuta-acciones";
import { MinutaDoc } from "@/components/minutas/minuta-doc";
import { requireUser } from "@/lib/auth/guards";
import { MINUTA_COLS, type MinutaFirma, type MinutaRow } from "@/lib/minutas";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Minuta de reunión | ESC" };

/** Version para imprimir y firmar en papel (para quien no usa el portal). */
export default async function ImprimirMinuta({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: m }, { data: fs }] = await Promise.all([
    supabase.from("minutas").select(MINUTA_COLS).eq("id", id).maybeSingle(),
    supabase.from("minuta_firmas").select("minuta_id, user_id, nombre, puesto, correo, firmada_at").eq("minuta_id", id).order("created_at"),
  ]);
  if (!m) notFound();
  const minuta = m as unknown as MinutaRow;
  return (
    <main className="mx-auto max-w-4xl bg-white px-6 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <PrintButton />
      </div>
      <header className="mb-4 flex items-center justify-between border-b-2 border-slate-800 pb-3">
        <Logo className="h-10" />
        <div className="text-right">
          <p className="text-lg font-bold">MINUTA DE REUNIÓN</p>
          <p className="font-mono text-sm">{minuta.numero}</p>
        </div>
      </header>
      <MinutaDoc m={minuta} firmas={(fs ?? []) as MinutaFirma[]} paraImprimir />
      <style>{`@page { size: letter; margin: 14mm; } @media print { body { background: white; } }`}</style>
    </main>
  );
}
