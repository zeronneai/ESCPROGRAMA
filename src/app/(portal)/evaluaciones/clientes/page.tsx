import { headers } from "next/headers";
import { EncuestasVendedor, type ClienteEncuesta } from "@/components/eval/encuestas-vendedor";
import { EvalControls } from "@/components/eval/eval-controls";
import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, StatCard } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { fechaLarga, loadPeriodos } from "@/lib/eval-server";
import { ENCUESTA_ESTADO, ESCALA_CLIENTE, ESCALA_CLIENTE_3, encuestaEstado, satisfaccion } from "@/lib/evaluaciones";
import { createClient } from "@/lib/supabase/server";

type Enc = { id: string; customer_id: string; vendedor_id: string; token: string; enviada_at: string | null; medio: string | null; respondida_at: string | null; puntaje: number | null; respuestas: Record<string, number>; escala: number; comentario: string | null; contesto_nombre: string | null; contesto_puesto: string | null; customers: { nombre: string } | null };

export default async function EvalClientes({ searchParams }: { searchParams: Promise<{ periodo?: string; vista?: string }> }) {
  const u = await requireRoles(["vendedor", "comprador", "jefe_ventas", "gerente", "ceo", "coordinador_iso"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { activo, programado, historial, actual } = await loadPeriodos(supabase, "clientes", sp.periodo);
  const [{ data: encs }, { data: qs }] = await Promise.all([
    actual
      ? supabase.from("encuestas_cliente").select("id, customer_id, vendedor_id, token, enviada_at, medio, respondida_at, puntaje, respuestas, escala, comentario, contesto_nombre, contesto_puesto, customers(nombre)").eq("periodo_id", actual.id).limit(5000)
      : Promise.resolve({ data: [] }),
    supabase.from("eval_preguntas").select("id, texto, orden, activo").eq("tipo", "cliente").order("orden"),
  ]);
  const encuestas = (encs ?? []) as unknown as Enc[];
  const respondidas = encuestas.filter((e) => e.respondida_at);
  const sat = satisfaccion(respondidas);
  // Preguntas del periodo: las que se contestaron (o las activas si aun no hay respuestas).
  const usadas = new Set(respondidas.flatMap((e) => Object.keys(e.respuestas ?? {})));
  const preguntas = (qs ?? []).filter((q) => (usadas.size ? usadas.has(q.id) : q.activo));
  const escala = respondidas[0]?.escala === 3 ? ESCALA_CLIENTE_3 : ESCALA_CLIENTE;
  const vista = sp.vista === "cliente" ? "cliente" : "pregunta";
  const vhref = (v: string) => `/evaluaciones/clientes?${new URLSearchParams({ ...(sp.periodo ? { periodo: sp.periodo } : {}), ...(v === "cliente" ? { vista: v } : {}) })}`;
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
    return { id, nombre: (sellers ?? []).find((s) => s.id === id)?.nombre ?? "Vendedor", generadas: l.length, enviadas: l.filter((e) => e.enviada_at).length, respondidas: r.length, sat: satisfaccion(r).pct };
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Encuesta de satisfacción de clientes" subtitle="ESC-VEN-FR-002. Cada cliente recibe su link: 10 preguntas con Insatisfecho, Poco satisfecho, Satisfecho o Muy satisfecho." />
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {activo ? (
            <p><Chip cls="bg-green-100 text-green-800">Activa</Chip> <strong>{activo.nombre}</strong> desde el {fechaLarga(activo.activado_at)}{activo.cierra_el && <> hasta el <strong>{fechaLarga(activo.cierra_el)}</strong></>}</p>
          ) : (
            <p className="text-slate-700">No hay evaluación activa.{isSeller && " Te llegará un aviso cuando se active."}</p>
          )}
          {programado && <p className="mt-1 text-xs text-slate-500">La siguiente se activa sola el {fechaLarga(programado.programado_para)} y avisa a los vendedores.</p>}
        </div>
        {canAct && <EvalControls tipo="clientes" activo={!!activo} programado={programado?.programado_para ?? null} cierraEl={activo?.cierra_el ?? null} />}
      </Card>

      {actual && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={isSeller ? "Mis links generados" : "Links generados"} value={encuestas.length} />
          <StatCard label="Enviadas" value={encuestas.filter((e) => e.enviada_at).length} />
          <StatCard label="Recibidas" value={respondidas.length} tone={respondidas.length ? "green" : "default"} hint={encuestas.length ? `${Math.round((respondidas.length / encuestas.length) * 100)}% de respuesta` : undefined} />
          <StatCard label="Satisfacción" value={sat.pct !== null ? `${sat.pct}%` : "-"} hint="Satisfecho o muy satisfecho" tone={sat.pct !== null && sat.pct >= 80 ? "green" : sat.pct !== null ? "amber" : "default"} />
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
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium sm:inline-grid">
            <a href={vhref("pregunta")} className={`whitespace-nowrap rounded-md px-5 py-2 text-center ${vista === "pregunta" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Por pregunta</a>
            <a href={vhref("cliente")} className={`whitespace-nowrap rounded-md px-5 py-2 text-center ${vista === "cliente" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Por cliente</a>
          </div>
          {vista === "pregunta" ? (
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Resultados por pregunta</h2>
              <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                {escala.map((e) => <span key={e.v} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-sm ${e.bar}`} />{e.label}</span>)}
              </div>
            </div>
            {respondidas.length === 0 ? <p className="text-sm text-slate-500">Aún no hay respuestas.</p> : (
              <ul className="space-y-4">
                {preguntas.map((q, qi) => {
                  const rows = respondidas.filter((e) => e.respuestas[q.id]);
                  const vals = rows.map((e) => Number(e.respuestas[q.id]));
                  const qs1 = satisfaccion(rows.map((e) => ({ respuestas: { x: e.respuestas[q.id] }, escala: e.escala })));
                  return (
                    <li key={q.id} className="space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-slate-800">{qi + 1}. {q.texto}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${qs1.pct === null ? "bg-slate-100 text-slate-500" : qs1.pct >= 85 ? "bg-green-100 text-green-800" : qs1.pct >= 70 ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-800"}`}>{qs1.pct ?? "-"}%</span>
                      </div>
                      <div className="flex h-4 overflow-hidden rounded bg-slate-100">
                        {escala.map((e) => {
                          const n = vals.filter((v) => v === e.v).length;
                          return n ? <div key={e.v} title={`${e.label}: ${n}`} className={`${e.bar} flex items-center justify-center text-[10px] font-semibold text-white`} style={{ width: `${(n / vals.length) * 100}%` }}>{n}</div> : null;
                        })}
                      </div>
                      <p className="text-xs text-slate-500">{escala.map((e) => `${e.label}: ${vals.filter((v) => v === e.v).length}`).join(" · ")}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          ) : (
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Resultados por cliente</h2>
            {respondidas.length === 0 ? <p className="text-sm text-slate-500">Aún no hay respuestas.</p> : (
              <ul className="space-y-2">
                {[...respondidas].sort((a, b) => Number(b.puntaje) - Number(a.puntaje)).map((e) => {
                  const p = Number(e.puntaje);
                  const esc = e.escala === 3 ? ESCALA_CLIENTE_3 : ESCALA_CLIENTE;
                  return (
                    <li key={e.id}>
                      <details className="group rounded-md border border-slate-200">
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
                          <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-900 sm:w-56">{e.customers?.nombre}</span>
                          <span className="relative h-4 flex-1 overflow-hidden rounded bg-slate-100">
                            <span className={`absolute inset-y-0 left-0 ${p >= 85 ? "bg-green-600" : p >= 70 ? "bg-lime-500" : p >= 50 ? "bg-orange-400" : "bg-red-500"}`} style={{ width: `${Math.max(2, p)}%` }} />
                          </span>
                          <span className="w-12 shrink-0 text-right text-sm font-semibold text-slate-800">{p}%</span>
                        </summary>
                        <div className="space-y-2 border-t border-slate-100 px-3 py-2 text-xs">
                          <p className="text-slate-600">Contestó {[e.contesto_nombre, e.contesto_puesto].filter(Boolean).join(", ") || "sin nombre"} el {fechaLarga(e.respondida_at)}</p>
                          <ol className="space-y-1">
                            {preguntas.filter((q) => e.respuestas[q.id]).map((q, i) => {
                              const v = Number(e.respuestas[q.id]);
                              const lab = esc.find((x) => x.v === v);
                              return (
                                <li key={q.id} className="flex items-start justify-between gap-3">
                                  <span className="text-slate-700">{i + 1}. {q.texto}</span>
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium text-white ${lab?.bar ?? "bg-slate-400"}`}>{lab?.label ?? v}</span>
                                </li>
                              );
                            })}
                          </ol>
                          {e.comentario && <p className="italic text-slate-700">Recomendaciones: &quot;{e.comentario}&quot;</p>}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          )}
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
                    {e.comentario && <p className="text-xs italic text-slate-600">&quot;{e.comentario}&quot;{e.contesto_nombre && `, ${e.contesto_nombre}`}{e.contesto_puesto && ` (${e.contesto_puesto})`}</p>}
                  </div>
                  <Chip cls={ENCUESTA_ESTADO[encuestaEstado(e)].cls}>{ENCUESTA_ESTADO[encuestaEstado(e)].label}{e.respondida_at ? ` · ${e.puntaje}%` : ""}</Chip>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
