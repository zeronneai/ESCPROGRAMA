import type { Metadata } from "next";
import { EncuestaForm } from "@/components/eval/encuesta-form";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Evaluación de servicio | ESC", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Encuesta publica: el cliente la abre con su link (sin cuenta). */
export default async function Encuesta({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{32,64}$/.test(token) ? await supabase.rpc("encuesta_publica", { p_token: token }) : { data: null };
  const e = data as { cliente: string; vendedor: string; periodo: string; respondida: boolean; preguntas: { id: string; texto: string }[] } | null;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex justify-center"><Logo className="h-10" /></div>
        {!e ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">Este link no es válido. Pida a su vendedor que se lo vuelva a enviar.</div>
        ) : e.respondida ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <p className="text-lg font-semibold text-green-900">Esta evaluación ya fue respondida</p>
            <p className="mt-1 text-sm text-green-800">Gracias, {e.cliente}.</p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-slate-900">Evaluación de servicio</h1>
              <p className="mt-1 text-sm text-slate-600">
                {e.cliente}: ¿cómo calificaría el servicio de ESC Representaciones? Le atiende {e.vendedor}. Le toma menos de un minuto.
              </p>
            </div>
            <EncuestaForm token={token} preguntas={e.preguntas ?? []} />
          </>
        )}
        <p className="text-center text-xs text-slate-400">ESC Representaciones · {e?.periodo ?? ""}</p>
      </div>
    </main>
  );
}
