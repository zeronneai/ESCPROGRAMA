import type { Metadata } from "next";
import { DateTime } from "luxon";
import { QuejaLinkForm } from "@/components/calidad/queja-link-form";
import { FondoAzul } from "@/components/marca";

export const metadata: Metadata = {
  title: "Quejas y reclamaciones | ESC Representaciones",
  description: "Envíe una queja o reclamación a ESC Representaciones. Nuestro coordinador de calidad la revisa y le contacta.",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Formato de queja de cliente (ESC-SGC-FR-002) para que el cliente lo llene desde un link, sin cuenta. */
export default function QuejasPublico() {
  const hoy = DateTime.now().setZone("America/Chihuahua").setLocale("es-MX").toFormat("d 'de' LLLL 'de' yyyy");
  return (
    <main className="min-h-screen bg-slate-50">
      <section className="relative isolate overflow-hidden px-4 pb-28 pt-8 text-white sm:pb-32">
        <FondoAzul />
        <div className="relative mx-auto max-w-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-esc.png" alt="ESC Representaciones" width={333} height={96} className="h-9 w-auto brightness-0 invert sm:h-10" />
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-sky-200">Atención a clientes</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Queja o reclamación</h1>
          <p className="mt-2 max-w-xl text-sky-100/90">
            Si algo no salió como esperaba, cuéntenos. Su queja llega directo a nuestro coordinador de calidad, quien la revisa y le contacta.
          </p>
        </div>
      </section>
      <section className="relative -mt-20 px-4 pb-10">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-200/70 sm:p-8">
          <QuejaLinkForm hoy={hoy} />
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-slate-400">ESC Representaciones · Formato ESC-SGC-FR-002 · Sus datos solo se usan para atender esta queja.</p>
      </section>
    </main>
  );
}
