import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { MetasEnVivo } from "@/components/metas/metas-en-vivo";
import { normalizarAvance } from "@/lib/metas-venta";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Metas de venta | ESC", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Pantalla publica de metas (para las teles): sin usuario ni contrasena; solo porcentajes. */
export default async function PantallaMetas() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("metas_ventas_publico");
  return (
    <main className="min-h-screen bg-[#eef3fb] px-4 pb-44 pt-5 sm:px-8 sm:pt-8">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <Logo className="h-9" />
        {error ? (
          <p className="rounded-2xl bg-white p-8 text-center text-lg text-slate-600 shadow-sm">Las metas todavía no están listas (falta la actualización 0081 en la base).</p>
        ) : (
          <MetasEnVivo inicial={normalizarAvance((data ?? []) as Record<string, unknown>[])} publico />
        )}
      </div>
    </main>
  );
}
