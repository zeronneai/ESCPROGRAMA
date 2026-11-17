const TZ = "America/Chihuahua";
const dia = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Las 3 fechas de una orden de Pegatron. La principal es cuando la jefa de ventas la subio al portal
 * (la pone el sistema y no se puede editar); despues la fecha de la OC y la entrega que pide Pegatron.
 */
export function FechasOc({ subida, fechaOc, entrega, grande = false }: { subida: string; fechaOc: string | null; entrega: string | null; grande?: boolean }) {
  const s = new Date(subida);
  const cuando = `${s.toLocaleDateString("es-MX", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })} ${s.toLocaleTimeString("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })}`;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${grande ? "text-sm" : "text-xs"}`}>
      <span className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 font-semibold text-white" title="Cuándo se subió al portal (automática)">
        Subida {cuando}
      </span>
      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700" title="Fecha en que Pegatron generó la orden">
        Fecha OC {fechaOc ? dia(fechaOc) : "sin dato"}
      </span>
      <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-900 ring-1 ring-amber-200" title="Entrega que pide Pegatron (la más próxima)">
        Entrega {entrega ? dia(entrega) : "sin dato"}
      </span>
    </div>
  );
}

/** La entrega mas proxima de los renglones. */
export const entregaMasProxima = (lineas: { entrega?: string | null }[]) =>
  lineas.map((l) => l.entrega).filter((x): x is string => !!x).sort()[0] ?? null;
