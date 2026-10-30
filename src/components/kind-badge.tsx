/** Etiqueta Cliente / Prospecto (sirve en componentes de servidor y de cliente). */
export function KindBadgeStatic({ tipo }: { tipo: "cliente" | "prospecto" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tipo === "cliente" ? "bg-green-100 text-green-800" : "bg-sky-100 text-sky-800"}`}>
      {tipo === "cliente" ? "Cliente" : "Prospecto"}
    </span>
  );
}
