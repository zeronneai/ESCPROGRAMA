import type { Metadata } from "next";
import { Logo } from "@/components/logo";
import { MetasEnVivo } from "@/components/metas/metas-en-vivo";
import { normalizarAvance } from "@/lib/metas-venta";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Metas de venta | ESC", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Pantalla publica de metas (para las teles): se abre con su link, sin usuario; solo porcentajes. */
export default async function PantallaMetas({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = /^[0-9a-f]{32,64}$/.test(token);
  const supabase = await createClient();
  const { data, error } = ok ? await supabase.rpc("metas_ventas_publico", { p_token: token }) : { data: null, error: true };
  return (
    <main className="min-h-screen bg-[#eef3fb] px-4 py-5 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <Logo className="h-9" />
        {error ? (
          <p className="rounded-2xl bg-white p-8 text-center text-lg text-slate-600 shadow-sm">Este link ya no es válido. Pide el nuevo a la jefa de ventas.</p>
        ) : (
          <MetasEnVivo inicial={normalizarAvance((data ?? []) as Record<string, unknown>[])} token={token} />
        )}
      </div>
    </main>
  );
}
