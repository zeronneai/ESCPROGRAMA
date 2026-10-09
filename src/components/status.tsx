import { semaforo } from "@/lib/time/business-hours";
import { ITEM_STATUS_LABEL, type ItemStatus, type ReferenceRow } from "@/lib/quotes/types";

const ITEM_TONE: Record<ItemStatus, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  cotizada: "bg-green-100 text-green-800",
  no_encontrada: "bg-slate-200 text-slate-700",
  enviada_cliente: "bg-brand-100 text-brand-900",
};

export function ItemStatusBadge({ estado, vencida }: { estado: ItemStatus; vencida?: boolean }) {
  if (estado === "pendiente" && vencida) {
    return <span className="rounded-full bg-slate-300 px-2 py-0.5 text-xs font-medium text-slate-800">Vencida</span>;
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ITEM_TONE[estado]}`}>{ITEM_STATUS_LABEL[estado]}</span>
  );
}

const SEMAFORO_TONE = {
  verde: "bg-green-100 text-green-800",
  amarillo: "bg-yellow-100 text-yellow-800",
  rojo: "bg-red-100 text-red-800",
  vencida: "bg-slate-300 text-slate-800",
} as const;

const fmtH = (h: number) => (h >= 10 ? Math.round(h).toString() : (Math.round(h * 10) / 10).toString());

/** Semaforo del plazo de 48 horas habiles. `remaining` en horas habiles (<= 0 es vencida). */
export function SemaforoBadge({ remaining }: { remaining: number }) {
  const s = semaforo(remaining);
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEMAFORO_TONE[s]}`}>
      {s === "vencida" ? "Vencida" : `Quedan ${fmtH(remaining)} h habiles`}
    </span>
  );
}

export function ReferenceList({ refs }: { refs: ReferenceRow[] }) {
  if (!refs.length) return <p className="text-xs text-slate-500">Sin referencias</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {refs.map((r) =>
        r.tipo === "imagen" ? (
          <li key={r.id}>
            {r.signedUrl ? (
              <a href={r.signedUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.signedUrl} alt="Referencia" className="h-20 w-20 rounded border border-slate-200 object-cover" />
              </a>
            ) : (
              <span className="text-xs text-slate-500">Imagen no disponible</span>
            )}
          </li>
        ) : (
          <li key={r.id}>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block max-w-xs truncate rounded border border-slate-200 bg-white px-2 py-1 text-xs text-brand-600 underline"
            >
              {r.url}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

export function qtyText(cantidad: number | string | null, unidad: string | null, talla: string | null): string {
  const parts: string[] = [];
  if (cantidad !== null && cantidad !== undefined && cantidad !== "") parts.push(`${Number(cantidad)} ${unidad ?? ""}`.trim());
  if (talla) parts.push(`Talla ${talla}`);
  return parts.join(" / ") || "Sin cantidad";
}
