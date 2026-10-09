import { DateTime } from "luxon";
import { Button, Card, Field, Input } from "@/components/ui";
import { requireBuyer } from "@/lib/auth/guards";
import { getBusinessSettings } from "@/lib/quotes/server";
import { auditActionLabel } from "@/lib/stats/timeline";
import { createClient } from "@/lib/supabase/server";

const SHOW = 200;

export default async function Auditoria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireBuyer();
  const sp = await searchParams;
  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const today = DateTime.now().setZone(cfg.timezone);
  const desde = sp.desde || today.minus({ days: 30 }).toISODate()!;
  const hasta = sp.hasta || today.toISODate()!;

  const [{ data }, { data: people }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, at, user_id, action, entity, entity_id, old_value, new_value")
      .gte("at", DateTime.fromISO(desde, { zone: cfg.timezone }).startOf("day").toUTC().toISO()!)
      .lte("at", DateTime.fromISO(hasta, { zone: cfg.timezone }).endOf("day").toUTC().toISO()!)
      .order("id", { ascending: false })
      .limit(SHOW),
    supabase.from("profiles").select("id, nombre"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id as string, p.nombre as string]));
  const qs = `desde=${desde}&hasta=${hasta}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Reporte de auditoria</h1>
        <div className="flex gap-2 text-sm">
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-100" href={`/api/admin/export?tipo=auditoria&formato=xlsx&${qs}`}>
            Exportar Excel
          </a>
          <a className="rounded-md border border-slate-300 bg-white px-3 py-2 hover:bg-slate-100" href={`/api/admin/export?tipo=auditoria&formato=csv&${qs}`}>
            Exportar CSV
          </a>
        </div>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Desde"><Input type="date" name="desde" defaultValue={desde} /></Field>
        <Field label="Hasta"><Input type="date" name="hasta" defaultValue={hasta} /></Field>
        <Button type="submit">Aplicar</Button>
      </form>
      <p className="text-xs text-slate-500">
        La bitacora es solo de insercion: nadie puede editarla ni borrarla. Se muestran los {SHOW} eventos mas recientes del rango; el archivo exportado trae todos.
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2">Fecha y hora</th><th className="px-3 py-2">Usuario</th><th className="px-3 py-2">Accion</th>
              <th className="px-3 py-2">Entidad</th><th className="px-3 py-2">Anterior</th><th className="px-3 py-2">Nuevo</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5 whitespace-nowrap">{new Date(a.at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "medium" })}</td>
                <td className="px-3 py-1.5">{a.user_id ? (names.get(a.user_id) ?? "usuario") : "sistema"}</td>
                <td className="px-3 py-1.5">{auditActionLabel(a.action)}</td>
                <td className="px-3 py-1.5">{a.entity}</td>
                <td className="max-w-xs break-words px-3 py-1.5 text-slate-500">{a.old_value ? JSON.stringify(a.old_value).slice(0, 160) : ""}</td>
                <td className="max-w-xs break-words px-3 py-1.5">{a.new_value ? JSON.stringify(a.new_value).slice(0, 160) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
