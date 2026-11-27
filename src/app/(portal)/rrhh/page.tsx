import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { CalendarioRh } from "@/components/rrhh/calendario";
import { SolicitarRh } from "@/components/rrhh/solicitar";
import { SolicitudFila } from "@/components/rrhh/solicitud-fila";
import { requireUser } from "@/lib/auth/guards";
import { ExternoRh } from "@/components/rrhh/gerencia";
import { ROL_LABEL } from "@/lib/ops/roles";
import type { Rol } from "@/lib/auth/route-guard";
import { fechaRh, num, quienAutoriza, reglaTxt, type Regla, type EventoCal, type Saldo, type Solicitud } from "@/lib/rrhh";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function rangoMes(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ini: `${mes}-01`, fin: `${mes}-${String(fin).padStart(2, "0")}` };
}

/** Vacaciones y permisos: cada colaborador ve sus dias, pide, y ve el calendario de la empresa. */
export default async function RrhhPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chihuahua" });
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : hoy.slice(0, 7);
  const { ini, fin } = rangoMes(mes);
  const [saldos, sols, cal, cfg, reglasQ] = await Promise.all([
    supabase.rpc("rrhh_saldos"),
    supabase.rpc("rrhh_solicitudes_ver"),
    supabase.rpc("rrhh_calendario", { p_desde: ini, p_hasta: fin }),
    supabase.from("rrhh_config").select("sabado_laborable, anticipacion_dias, adelanto_max").eq("id", 1).maybeSingle(),
    supabase.from("rrhh_reglas").select("id, tipo, texto, desde, hasta, valor, puesto, activo").eq("activo", true).order("created_at"),
  ]);
  if (saldos.error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Vacaciones y permisos" />
        <EmptyState title="Falta la actualización de la base">Corre <code>0092_rrhh_vacaciones_permisos.sql</code> en el SQL Editor de Supabase.</EmptyState>
      </div>
    );
  }
  const todos = (saldos.data ?? []) as Saldo[];
  const yo = todos.find((s) => s.empleado_id === user.id);
  const lista = (sols.data ?? []) as Solicitud[];
  const mias = lista.filter((s) => s.mia);
  const equipo = lista.filter((s) => s.soy_jefe && !s.mia);
  const equipoPend = equipo.filter((s) => s.estado === "pendiente");
  const c = cfg.data ?? { sabado_laborable: true, anticipacion_dias: 0, adelanto_max: 0 };
  const gerente = user.rol === "gerente" || user.rol === "ceo";
  // Jefes (jefa de ventas, sup. de almacen, sup. de finanzas): ven los dias de su equipo.
  const miEquipo = gerente ? [] : todos.filter((s) => s.empleado_id !== user.id);
  const sinPortal = todos.filter((s) => s.sin_portal);
  const puedeSinPortal = user.rol === "supervisor_almacen";
  // Cualquier jefe pide por los sin portal de su area (ej. la jefa de ventas por Jose Ortiz).
  const pidePorOtros = ["supervisor_almacen", "jefe_ventas", "supervisor_finanzas"].includes(user.rol);

  const Card = ({ t, v, sub, tono = "" }: { t: string; v: string; sub?: string; tono?: string }) => (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${tono}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t}</p>
      <p className="mt-1 text-2xl font-bold">{v}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vacaciones y permisos"
        subtitle="Revisa tus días, pide vacaciones o permisos y mira el calendario de la empresa."
        actions={gerente ? <Link href="/rrhh/gerencia" className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 hover:bg-brand-100">Administrar</Link> : undefined}
      />

      {yo?.capturado ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card t="Días disponibles" v={num(yo.disponible)} sub={Number(yo.pendientes) > 0 ? `${num(yo.pendientes)} en espera de autorización` : "para pedir"} tono={Number(yo.disponible) < 0 ? "border-red-300" : "border-brand-200"} />
            <Card t="Te tocan por ley" v={`${yo.dias_ley ?? 0} días`} sub={`Por tus ${yo.anios} ${yo.anios === 1 ? "año" : "años"} cumplidos`} />
            <Card t="Próximo aniversario" v={fechaRh(yo.proximo_aniversario)} sub={`Ganas ${yo.dias_proximo ?? 0} días`} />
            <Card t="Permisos este año" v={String(yo.permisos_anio)} sub="autorizados" />
          </div>
          <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <summary className="cursor-pointer font-medium text-slate-700">¿Cómo se calculan mis días?</summary>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li>Ingreso: <b>{fechaRh(yo.fecha_ingreso)}</b>{yo.puesto ? ` · ${yo.puesto}` : ""}{` · Autoriza: ${quienAutoriza(yo.jefe_rol).toLowerCase()}`}</li>
              <li>Te quedaban <b>{num(yo.saldo_inicial)}</b> días al {fechaRh(yo.saldo_al)} (lo capturó la gerente).</li>
              {Number(yo.ganados) > 0 && <li>+ {num(yo.ganados)} días ganados en tu aniversario.</li>}
              {Number(yo.usados) > 0 && <li>− {num(yo.usados)} días de vacaciones autorizadas.</li>}
              {Number(yo.temporada) > 0 && <li>− {num(yo.temporada)} días de vacaciones generales (Semana Santa / Navidad).</li>}
              {Number(yo.pendientes) > 0 && <li>− {num(yo.pendientes)} días en espera de autorización.</li>}
              <li>= <b>{num(yo.disponible)}</b> disponibles.</li>
            </ul>
            <p className="mt-2 text-xs text-slate-500">Por la Ley Federal del Trabajo (art. 76): 12 días el 1er año, 14 el 2º, 16 el 3º, 18 el 4º, 20 el 5º, y luego 2 más cada 5 años. Domingos y festivos no se descuentan.</p>
          </details>
        </>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">La gerente todavía no captura tu fecha de ingreso y los días que te quedan. En cuanto lo haga, aquí vas a ver tus días disponibles.</p>
      )}

      {(reglasQ.data?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <h2 className="font-semibold text-slate-800">Reglas de vacaciones</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
            {((reglasQ.data ?? []) as Regla[]).map((r) => <li key={r.id}>{reglaTxt(r)}</li>)}
          </ul>
        </section>
      )}

      <SolicitarRh
        disponible={yo?.disponible ?? null}
        capturado={!!yo?.capturado}
        hoy={hoy}
        anticipacion={c.anticipacion_dias}
        adelanto={c.adelanto_max}
        para={pidePorOtros ? sinPortal.map((x) => ({ id: x.colaborador_id, nombre: x.nombre, capturado: x.capturado, disponible: x.disponible })) : []}
      />

      {(miEquipo.length > 0 || puedeSinPortal) && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Días de mi equipo</h2>
            {puedeSinPortal && <ExternoRh gerente={false} />}
          </div>
          {pidePorOtros && sinPortal.length > 0 && <p className="text-xs text-slate-500">Para pedir por los que no tienen portal, elígelos arriba en "¿Para quién?".</p>}
          {puedeSinPortal && <p className="text-xs text-slate-500">También puedes dar de alta a los que no tienen portal; la gerente les captura la fecha de ingreso y los días.</p>}
          {miEquipo.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
              {miEquipo.map((s) => (
                <li key={s.colaborador_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.nombre} <span className="text-xs font-normal text-slate-500">{s.puesto ?? (s.rol ? ROL_LABEL[s.rol as Rol] ?? s.rol : "")}</span>
                      {s.sin_portal && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">SIN PORTAL</span>}
                    </p>
                    <p className="text-xs text-slate-500">{s.capturado ? `Ingreso ${fechaRh(s.fecha_ingreso)} · por ley ${s.dias_ley} días · ${s.permisos_anio} permisos este año` : "La gerente aún no captura sus días"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.capturado && (
                      <div className="text-right">
                        <p className="text-lg font-bold">{num(s.disponible)}</p>
                        <p className="text-[11px] text-slate-500">disponibles{Number(s.pendientes) > 0 ? ` · ${num(s.pendientes)} en espera` : ""}</p>
                      </div>
                    )}
                    {puedeSinPortal && s.sin_portal && <ExternoRh s={s} gerente={false} />}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Todavía no hay nadie en tu equipo.</p>
          )}
        </section>
      )}

      {equipo.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Solicitudes de mi equipo {equipoPend.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{equipoPend.length} por dar visto bueno</span>}</h2>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">{equipo.slice(0, 30).map((s) => <SolicitudFila key={s.id} s={s} modo="jefe" hoy={hoy} />)}</ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Mis solicitudes</h2>
        {mias.length ? <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">{mias.map((s) => <SolicitudFila key={s.id} s={s} modo="mia" hoy={hoy} />)}</ul> : <p className="text-sm text-slate-500">Aún no has pedido nada.</p>}
      </section>

      <CalendarioRh mes={mes} eventos={(cal.data ?? []) as EventoCal[]} hoy={hoy} sabadoLaborable={c.sabado_laborable} />
    </div>
  );
}
