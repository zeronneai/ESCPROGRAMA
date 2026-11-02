import { headers } from "next/headers";
import { EncuestasVendedor, type ClienteEncuesta } from "@/components/eval/encuestas-vendedor";
import { EvalControls } from "@/components/eval/eval-controls";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { fechaLarga, loadPeriodos } from "@/lib/eval-server";
import { ESCALA_CLIENTE, satisfaccion } from "@/lib/evaluaciones";
import { createClient } from "@/lib/supabase/server";

type Enc = { id: string; customer_id: string; vendedor_id: string; token: string; enviada_at: string | null; medio: string | null; respondida_at: string | null; puntaje: number | null; respuestas: Record<string, number>; comentario: string | null; contesto_nombre: string | null; customers: { nombre: string } | null };

export default async function EvalClientes({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const u = await requireRoles(["vendedor", "comprador", "jefe_ventas", "gerente", "coordinador_iso"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { activo, programado, historial, actual } = await loadPeriodos(supabase, "clientes", sp.periodo);
  const [{ data: encs }, { data: qs }] = await Promise.all([
    actual
      ? supabase.from("encuestas_cliente").select("id, customer_id, vendedor_id, token, enviada_at, medio, respondida_at, puntaje, respuestas, comentario, contesto_nombre, customers(nombre)").eq("periodo_id", actual.id).limit(5000)
      : Promise.resolve({ data: [] }),
    supabase.from("eval_preguntas").select("id, texto, orden").eq("tipo", "cliente").eq("activo", true).order("orden"),
  ]);
  const encuestas = (encs ?? []) as unknown as Enc[];
  const respondidas = encuestas.filter((e) => e.respondida_at);
  const sat = satisfaccion(respondidas.map((e) => e.respuestas));
  const canAct = u.rol === "comprador" || u.rol === "jefe_ventas";
  const isSeller = u.rol === "vendedor";

  let sellerRows: ClienteEncuesta[] = [];
  if (isSeller) {
    const { data: cs } = await supabase.from("customers").select("id, nombre, contacto_nombre, contacto_telefono, contacto_correo").eq("tipo", "cliente").eq("activo", true).order("nombre").limit(1000);
    sellerRows = (cs ?? []).map((c) => {
      const e = encuestas.find((x) => x.customer_id === c.id);
      return {
        customer_id: c.id, nombre: c.nombre, contacto: c.contacto_nombre, telefono: c.contacto_telefono, correo: c.contacto_correo,
        encuesta: e ? { id: e.id, token: e.token, enviada_at: e.enviada_at, medio: e.medio, respondida_at: e.respondida_at, puntaje: e.puntaje === null ? null : Number(e.puntaje) } : null,
      };
    });
  }
  const sellerIds = [...new Set(encuestas.map((e) => e.vendedor_id))];
  const { data: sellers } = !isSeller && sellerIds.length ? await supabase.from("profiles").select("id, nombre").in("id", sellerIds) : { data: [] };
  const porVendedor = sellerIds.map((id) => {
    const l = encuestas.filter((e) => e.vendedor_id === id);
    const r = l.filter((e) => e.respondida_at);
    return { id, nombre: (sellers ?? []).find((s) => s.id === id)?.nombre ?? "Vendedor", generadas: l.length, enviadas: l.filter((e) => e.enviada_at).length, respondidas: r.length, sat: satisfaccion(r.map((e) => e.respuestas)).pct };
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Evaluación de clientes" subtitle="El cliente califica a ESC dos veces al año: 5 preguntas, No satisfactorio, Satisfactorio o Muy satisfactorio." />
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {activo ? (
            <p><Chip cls="bg-green-100 text-green-800">Activa</Chip> <strong>{activo.nombre}</strong> desde el {fechaLarga(activo.activado_at)}</p>
          ) : (
            <p className="text-slate-700">No hay evaluación activa.{isSeller && " Te llegará un aviso cuando se active."}</p>
          )}
          {programado && <p className="mt-1 text-xs text-slate-500">La siguiente se activa sola el {fechaLarga(programado.programado_para)} y avisa a los vendedores.</p>}
        </div>
        {canAct && <EvalControls tipo="clientes" activo={!!activo} programado={programado?.programado_para ?? null} />}
      </Card>

      {actual && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={isSeller ? "Mis links generados" : "Links generados"} value={encuestas.length} />
          <StatCard label="Enviadas" value={encuestas.filter((e) => e.enviada_at).length} />
          <StatCard label="Respondidas" value={respondidas.length} tone={respondidas.length ? "green" : "default"} hint={encuestas.length ? `${Math.round((respondidas.length / encuestas.length) * 100)}% de respuesta` : undefined} />
          <StatCard label="Satisfacción" value={sat.pct !== null ? `${sat.pct}%` : "-"} hint="Satisfactorio o muy satisfactorio" tone={sat.pct !== null && sat.pct >= 80 ? "green" : sat.pct !== null ? "amber" : "default"} />
        </div>
      )}

      {historial.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {historial.map((p) => <FilterChip key={p.id} href={`/evaluaciones/clientes?periodo=${p.id}`} active={p.id === actual?.id}>{p.nombre}{p.estado === "activo" ? " (activa)" : ""}</FilterChip>)}
        </div>
      )}

      {isSeller ? (
        <EncuestasVendedor rows={sellerRows} origin={origin} activa={!!activo && actual?.id === activo.id} vendedor={u.nombre} />
      ) : actual ? (
        <>
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Resultados por pregunta</h2>
            {respondidas.length === 0 ? <p className="text-sm text-slate-500">Aún no hay respuestas.</p> : (
              <ul className="space-y-3">
                {(qs ?? []).map((q) => {
                  const vals = respondidas.map((e) => Number(e.respuestas[q.id])).filter(Boolean);
                  return (
                    <li key={q.id} className="space-y-1">
                      <p className="text-sm text-slate-800">{q.orden}. {q.texto}</p>
                      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                        {ESCALA_CLIENTE.map((e) => {
                          const n = vals.filter((v) => v === e.v).length;
                          return n ? <div key={e.v} title={`${e.label}: ${n}`} className={e.v === 1 ? "bg-red-500" : e.v === 2 ? "bg-amber-400" : "bg-green-600"} style={{ width: `${(n / vals.length) * 100}%` }} /> : null;
                        })}
                      </div>
                      <p className="text-xs text-slate-500">{ESCALA_CLIENTE.map((e) => `${e.label}: ${vals.filter((v) => v === e.v).length}`).join(" · ")}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card className="overflow-x-auto p-0">
            {porVendedor.length === 0 ? <EmptyState title="Ningún vendedor ha generado links en este periodo" /> : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2.5">Vendedor</th><th className="px-3 py-2.5 text-right">Links</th><th className="px-3 py-2.5 text-right">Enviadas</th><th className="px-3 py-2.5 text-right">Respondidas</th><th className="px-4 py-2.5 text-right">Satisfacción</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {porVendedor.map((v) => (
                    <tr key={v.id}><td className="px-4 py-2.5 font-medium">{v.nombre}</td><td className="px-3 py-2.5 text-right">{v.generadas}</td><td className="px-3 py-2.5 text-right">{v.enviadas}</td><td className="px-3 py-2.5 text-right">{v.respondidas}</td><td className="px-4 py-2.5 text-right">{v.sat !== null ? `${v.sat}%` : "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card className="p-0">
            <h2 className="px-4 pt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Clientes</h2>
            <ul className="divide-y divide-slate-100">
              {encuestas.sort((a, b) => (b.respondida_at ?? "").localeCompare(a.respondida_at ?? "")).map((e) => (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{e.customers?.nombre}</p>
                    {e.comentario && <p className="text-xs italic text-slate-600">"{e.comentario}"{e.contesto_nombre && `, ${e.contesto_nombre}`}</p>}
                  </div>
                  {e.respondida_at ? <Chip cls={Number(e.puntaje) >= 50 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>Respondió · {e.puntaje}%</Chip> : e.enviada_at ? <Chip cls="bg-sky-100 text-sky-800">Enviada</Chip> : <Chip cls="bg-amber-100 text-amber-900">Sin enviar</Chip>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
