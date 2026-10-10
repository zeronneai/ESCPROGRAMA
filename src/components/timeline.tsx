import { Card } from "@/components/ui";
import type { TimelineEvent } from "@/lib/stats/timeline";

const fmt = (iso: string) => new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

export function Timeline({ events, title = "Linea de tiempo" }: { events: TimelineEvent[]; title?: string }) {
  return (
    <Card>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">Sin eventos.</p>
      ) : (
        <ol className="space-y-1.5 border-l-2 border-slate-200 pl-4 text-sm">
          {events.map((e, i) => (
            <li key={i}>
              <span className="text-xs text-slate-500">{fmt(e.at)}</span>
              <p>{e.text}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
