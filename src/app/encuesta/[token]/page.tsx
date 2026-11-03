import type { Metadata } from "next";
import { EncuestaForm } from "@/components/eval/encuesta-form";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Encuesta de satisfacción | ESC", robots: { index: false } };
export const dynamic = "force-dynamic";

type Pub = {
  cliente: string;
  razon_social: string | null;
  direccion: string | null;
  contacto: string | null;
  vendedor: string;
  periodo: string;
  respondida: boolean;
  cerrada: boolean;
  cierra_el: string | null;
  preguntas: { id: string; texto: string }[];
};

/** Encuesta de satisfaccion de cliente (ESC-VEN-FR-002): el cliente la abre con su link, sin cuenta. */
export default async function Encuesta({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = /^[0-9a-f]{32,64}$/.test(token) ? await supabase.rpc("encuesta_publica", { p_token: token }) : { data: null };
  const e = data as Pub | null;
  const hoy = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex justify-center"><Logo className="h-10" /></div>
        {!e ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">Este link no es válido. Pida a su vendedor que se lo vuelva a enviar.</div>
        ) : e.respondida ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
            <p className="text-lg font-semibold text-green-900">Esta encuesta ya fue respondida</p>
            <p className="mt-1 text-sm text-green-800">Gracias, {e.cliente}.</p>
          </div>
        ) : e.cerrada ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">Esta encuesta ya cerró. Gracias por su interés.</div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-slate-900">Encuesta de satisfacción de cliente</h1>
              <p className="mt-1 text-sm text-slate-600">
                Para ESC Representaciones es muy importante saber cómo calificaría nuestro servicio. Le toma un par de minutos.
              </p>
            </div>
            <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Cliente</dt><dd className="font-medium text-slate-900">{e.razon_social || e.cliente}</dd></div>
              <div><dt className="text-xs text-slate-500">Fecha</dt><dd className="text-slate-900">{hoy}</dd></div>
              {e.direccion && <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Dirección</dt><dd className="text-slate-900">{e.direccion}</dd></div>}
              <div><dt className="text-xs text-slate-500">Le atiende</dt><dd className="text-slate-900">{e.vendedor}</dd></div>
              {e.cierra_el && <div><dt className="text-xs text-slate-500">Disponible hasta</dt><dd className="text-slate-900">{new Date(`${e.cierra_el}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</dd></div>}
            </dl>
            <EncuestaForm token={token} preguntas={e.preguntas ?? []} contacto={e.contacto} />
          </>
        )}
        <p className="text-center text-xs text-slate-400">ESC Representaciones · ESC-VEN-FR-002 · {e?.periodo ?? ""}</p>
      </div>
    </main>
  );
}
