import { Card } from "@/components/ui";
import { SEND_MEDIUM_LABEL } from "@/lib/stats/timeline";

export interface IssueListItem {
  id: string;
  numero: string;
  emitida_at: string;
  totals: { currency: string; amount: string }[];
  motivo: string | null;
  sends: { medio: string; destinatario: string | null; enviado_at: string }[];
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" });

/** Cotizaciones enviadas al cliente (solo lectura): numero, total, medio y PDF exacto. */
export function IssuesList({ issues, requestId, title = "Cotizaciones enviadas al cliente" }: { issues: IssueListItem[]; requestId: string; title?: string }) {
  if (!issues.length) return null;
  return (
    <Card className="p-0">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">{title} ({issues.length})</h2>
      <ul className="divide-y divide-slate-100">
        {issues.map((x, idx) => (
          <li key={x.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{x.numero}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${idx === 0 ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"}`}>{idx === 0 ? "Vigente" : "Reemplazada"}</span>
                <span className="tabular-nums text-slate-600">{x.totals.map((t) => `${t.amount} ${t.currency}`).join(" + ")}</span>
              </p>
              {x.motivo && <p className="text-xs text-amber-800">Recotización: {x.motivo}</p>}
              <p className="text-xs text-slate-500">{x.sends.map((s) => `${fmt(s.enviado_at)} por ${SEND_MEDIUM_LABEL[s.medio] ?? s.medio}${s.destinatario ? ` (${s.destinatario})` : ""}`).join(" · ")}</p>
            </div>
            <a href={`/api/pdf/${requestId}?emision=${x.id}`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline">Descargar PDF</a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Convierte las filas de la base al formato de la lista. */
export function toIssueList(
  issues: Array<{ id: string; numero: string; emitida_at: string; snapshot: unknown; quote_issue_sends?: { medio: string; destinatario: string | null; enviado_at: string }[] }>,
  renegs: Array<{ issue_id: string | null; motivo: string }>,
): IssueListItem[] {
  return issues.map((x) => ({
    id: x.id,
    numero: x.numero,
    emitida_at: x.emitida_at,
    totals: ((x.snapshot as { totals?: { currency: string; amount: string }[] })?.totals ?? []),
    motivo: renegs.find((r) => r.issue_id === x.id)?.motivo ?? null,
    sends: [...(x.quote_issue_sends ?? [])].sort((a, b) => a.enviado_at.localeCompare(b.enviado_at)),
  }));
}
