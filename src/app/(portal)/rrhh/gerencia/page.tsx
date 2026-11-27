import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { CalendarioRh } from "@/components/rrhh/calendario";
import { EmpleadoRh, FestivosRh, ReglasRh, TemporadaRh } from "@/components/rrhh/gerencia";
import { SolicitudFila } from "@/components/rrhh/solicitud-fila";
import { requireRoles } from "@/lib/auth/sales";
import { ROL_LABEL } from "@/lib/ops/roles";
import { fechaRh, num, rangoRh, type EventoCal, type Saldo, type Solicitud } from "@/lib/rrhh";
import type { Rol } from "@/lib/auth/route-guard";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABS = [
  ["solicitudes", "Solicitudes"],
  ["colaboradores", "Colaboradores y días"],
  ["temporadas", "Vacaciones generales"],
  ["festivos", "Días festivos"],
  ["reglas", "Reglas"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Gerente (y CEO): captura el arranque de cada colaborador, autoriza, temporadas, festivos y reglas. */
export default async function RrhhGerencia({ searchParams }: { searchParams: Promise<{ tab?: string; mes?: string }> }) {
  await requireRoles(["gerente", "ceo"]);
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "solicitudes") as Tab;
  const supabase = await createClient();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chihuahua" });
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const fin = `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const [saldos, sols, cal, cfg, tabla, fest, temps] = await Promise.all([
    supabase.rpc("rrhh_saldos"),
    supabase.rpc("rrhh_solicitudes_ver"),
    supabase.rpc("rrhh_calendario", { p_desde: `${mes}-01`, p_hasta: fin }),
    supabase.from("rrhh_config").select("sabado_laborable, anticipacion_dias, adelanto_max").eq("id", 1).maybeSingle(),
    supabase.from("rrhh_tabla_dias").select("anios, dias").order("anios"),
    supabase.from("rrhh_festivos").select("fecha, nombre").order("fecha"),
    supabase.from("rrhh_temporadas").select("id, nombre, desde, hasta, dias_descuento").order("desde", { ascending: false }),
  ]);
  const header = <PageHeader title="Vacaciones y permisos: gerencia" subtitle="Captura los días de cada colaborador, autoriza solicitudes y define festivos y vacaciones generales." actions={<Link href="/rrhh" className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Mis vacaciones</Link>} />;
  if (saldos.error) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState title="Falta la actualización de la base">Corre <code>0092_rrhh_vacaciones_permisos.sql</code> en el SQL Editor de Supabase.</EmptyState>
      </div>
    );
  }
  const todos = (saldos.data ?? []) as Saldo[];
  const lista = (sols.data ?? []) as Solicitud[];
  const abiertas = lista.filter((s) => s.estado === "pendiente" || s.estado === "visto_jefe");
  const resto = lista.filter((s) => !(s.estado === "pendiente" || s.estado === "visto_jefe"));
  const c = cfg.data ?? { sabado_laborable: true, anticipacion_dias: 0, adelanto_max: 0 };
  const festivos = (fest.data ?? []) as { fecha: string; nombre: string }[];
  const temporadas = (temps.data ?? []) as { id: string; nombre: string; desde: string; hasta: string; dias_descuento: string[] }[];
  const sinCapturar = todos.filter((s) => !s.capturado).length;

  return (
    <div className="space-y-5">
      {header}
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {TABS.map(([k, t]) => (
          <Link key={k} href={`/rrhh/gerencia?tab=${k}`} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:border-brand-400"}`}>
            {t}
            {k === "solicitudes" && abiertas.length > 0 && <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs text-amber-950">{abiertas.length}</span>}
            {k === "colaboradores" && sinCapturar > 0 && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs text-slate-700">{sinCapturar} sin capturar</span>}
          </Link>
        ))}
      </nav>

      {tab === "solicitudes" && (
        <>
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Por autorizar ({abiertas.length})</h2>
            {abiertas.length ? <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">{abiertas.map((s) => <SolicitudFila key={s.id} s={s} modo="gerente" hoy={hoy} />)}</ul> : <p className="text-sm text-slate-500">No hay solicitudes en espera.</p>}
          </section>
          <CalendarioRh mes={mes} eventos={(cal.data ?? []) as EventoCal[]} hoy={hoy} sabadoLaborable={c.sabado_laborable} href={(x) => `/rrhh/gerencia?tab=solicitudes&mes=${x}`} />
          {resto.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Historial</h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">{resto.slice(0, 100).map((s) => <SolicitudFila key={s.id} s={s} modo="gerente" hoy={hoy} />)}</ul>
            </section>
          )}
        </>
      )}

      {tab === "colaboradores" && (
        <section className="space-y-2">
          <p className="text-sm text-slate-600">Para arrancar, de cada colaborador pon su <b>fecha de ingreso</b> y los <b>días de vacaciones que le quedan hoy</b>. A partir de ahí el portal suma los días de ley en cada aniversario y resta lo que autorices y las vacaciones generales.</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
            {todos.map((s) => (
              <li key={s.empleado_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{s.nombre} <span className="text-xs font-normal text-slate-500">{s.puesto ?? ROL_LABEL[s.rol as Rol] ?? s.rol}</span></p>
                  {s.capturado ? (
                    <p className="text-xs text-slate-500">
                      Ingreso {fechaRh(s.fecha_ingreso)} · {s.anios} {s.anios === 1 ? "año" : "años"} · por ley {s.dias_ley} días · aniversario {fechaRh(s.proximo_aniversario)} (+{s.dias_proximo})
                      {s.jefe_nombre ? ` · jefe: ${s.jefe_nombre}` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-700">Sin capturar</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {s.capturado && (
                    <div className="text-right">
                      <p className={`text-lg font-bold ${Number(s.disponible) < 0 ? "text-red-600" : "text-slate-900"}`}>{num(s.disponible)}</p>
                      <p className="text-[11px] text-slate-500">disponibles{Number(s.pendientes) > 0 ? ` · ${num(s.pendientes)} en espera` : ""}</p>
                    </div>
                  )}
                  <EmpleadoRh s={s} todos={todos} hoy={hoy} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "temporadas" && (
        <section className="space-y-3">
          <p className="text-sm text-slate-600">En Semana Santa y Navidad toda la empresa descansa. Pon el rango y elige qué días <b>se descuentan</b> a todos; los demás días del rango los da la empresa y no se descuentan.</p>
          <TemporadaRh festivos={festivos.map((f) => f.fecha)} sabadoLaborable={c.sabado_laborable} />
          {temporadas.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {temporadas.map((t) => (
                <li key={t.id} className="space-y-1 px-4 py-3">
                  <p className="font-semibold">{t.nombre} <span className="text-sm font-normal text-slate-500">· {rangoRh(t.desde, t.hasta)}</span></p>
                  <p className="text-xs text-slate-600">Se descuentan {t.dias_descuento.length} días{t.dias_descuento.length ? `: ${t.dias_descuento.map((d) => fechaRh(d, false)).join(", ")}` : ""}</p>
                  <TemporadaRh t={t} festivos={festivos.map((f) => f.fecha)} sabadoLaborable={c.sabado_laborable} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No hay temporadas todavía.</p>
          )}
        </section>
      )}

      {tab === "festivos" && <FestivosRh festivos={festivos} />}

      {tab === "reglas" && <ReglasRh cfg={c} tabla={(tabla.data ?? []) as { anios: number; dias: number }[]} />}
    </div>
  );
}
