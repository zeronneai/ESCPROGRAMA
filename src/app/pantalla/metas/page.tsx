import type { Metadata } from "next";
import { PantallaTV, type ExtraPantalla } from "@/components/metas/pantalla-tv";
import { normalizarAvance } from "@/lib/metas-venta";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Metas de venta | ESC", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Pantalla publica de metas (para las teles): sin usuario ni contrasena; solo porcentajes, en una sola vista. */
export default async function PantallaMetas() {
  const supabase = await createClient();
  const [{ data, error }, extra] = await Promise.all([supabase.rpc("metas_ventas_publico"), supabase.rpc("metas_pantalla_extra")]);
  if (error) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#eef3fb] p-8">
        <p className="rounded-2xl bg-white p-8 text-center text-lg text-slate-600 shadow-sm">Las metas todavía no están listas (falta la actualización 0081 en la base).</p>
      </main>
    );
  }
  return <PantallaTV inicial={normalizarAvance((data ?? []) as Record<string, unknown>[])} extraInicial={extra.error ? null : (extra.data as ExtraPantalla)} />;
}
