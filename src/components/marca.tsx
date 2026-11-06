import { APP_NOMBRE } from "@/lib/marca";

/** Nombre de la plataforma: "ESC" fuerte y "One" en azul claro. */
export function Wordmark({ className = "", claro = false }: { className?: string; claro?: boolean }) {
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      <span className={claro ? "text-white" : "text-brand-900"}>{APP_NOMBRE.split(" ")[0]}</span>{" "}
      <span className={claro ? "text-sky-300" : "text-brand-600"}>{APP_NOMBRE.split(" ").slice(1).join(" ")}</span>
    </span>
  );
}

/** Fondo azul de la marca: degradado, circulos finos (como el catalogo) y curvas de azules abajo. */
export function FondoAzul({ className = "", ondas = true }: { className?: string; ondas?: boolean }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a1a44] via-[#0f2f7a] to-[#1d5fd6]" />
      <div className="absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full border border-white/15" />
      <div className="absolute -right-8 -top-40 h-[34rem] w-[34rem] rounded-full border border-white/10" />
      <div className="absolute -left-32 top-1/3 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
      {ondas && <Ondas className="absolute inset-x-0 bottom-0 h-40 w-full sm:h-56" />}
    </div>
  );
}

/** Franja de curvas en varios azules. */
export function Ondas({ className = "", haciaBlanco = false }: { className?: string; haciaBlanco?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 1440 320" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="#3b82f6" fillOpacity="0.35" d="M0,192L60,170.7C120,149,240,107,360,112C480,117,600,171,720,186.7C840,203,960,181,1080,154.7C1200,128,1320,96,1380,80L1440,64L1440,320L0,320Z" />
      <path fill="#60a5fa" fillOpacity="0.35" d="M0,256L80,234.7C160,213,320,171,480,170.7C640,171,800,213,960,224C1120,235,1280,213,1360,202.7L1440,192L1440,320L0,320Z" />
      <path fill="#93c5fd" fillOpacity="0.45" d="M0,288L90,272C180,256,360,224,540,229.3C720,235,900,277,1080,282.7C1260,288,1350,256,1395,240L1440,224L1440,320L0,320Z" />
      {haciaBlanco && <path fill="#f8fafc" d="M0,304L120,298.7C240,293,480,283,720,288C960,293,1200,315,1320,320L1440,320L1440,320L0,320Z" />}
    </svg>
  );
}
