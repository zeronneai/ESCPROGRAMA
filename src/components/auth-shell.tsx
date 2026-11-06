import { FondoAzul, Wordmark } from "@/components/marca";
import { APP_LEMA } from "@/lib/marca";

/** Pantalla de entrada: panel azul de bienvenida con curvas y, a un lado, la tarjeta del formulario. */
export function AuthShell({ titulo, subtitulo, children, pie }: { titulo: string; subtitulo?: string; children: React.ReactNode; pie?: React.ReactNode }) {
  return (
    <main className="relative min-h-screen bg-slate-50 lg:grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative isolate flex min-h-[19rem] flex-col justify-between overflow-hidden px-6 pb-24 pt-8 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:pb-14 lg:pt-12">
        <FondoAzul />
        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-esc.png" alt="ESC Representaciones" width={333} height={96} className="h-9 w-auto brightness-0 invert sm:h-11" />
        </div>
        <div className="relative mt-8 max-w-lg lg:mt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-200">ESC Representaciones</p>
          <h2 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            <Wordmark claro />
          </h2>
          <p className="mt-4 text-base text-sky-100/90 sm:text-lg">{APP_LEMA}. Ventas, compras, almacén y calidad trabajando como un solo equipo.</p>
        </div>
        <p className="relative mt-8 hidden text-xs text-sky-100/70 lg:block">Chihuahua, México · Empresa en proceso de certificación ISO 9001</p>
      </section>

      <section className="relative -mt-16 flex items-start justify-center px-4 pb-10 lg:mt-0 lg:items-center lg:px-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200/70 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
            {subtitulo && <p className="mt-1 text-sm text-slate-600">{subtitulo}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {pie && <div className="mt-4 text-center">{pie}</div>}
        </div>
      </section>
    </main>
  );
}
