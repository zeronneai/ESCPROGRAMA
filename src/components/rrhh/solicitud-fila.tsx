import { ROL_LABEL } from "@/lib/ops/roles";
import { diasEntre, ESTADO_COLOR, ESTADO_LABEL, fechaRh, isoDow, JEFE_LABEL, num, PERMISO_LABEL, rangoRh, type Solicitud } from "@/lib/rrhh";
import type { Rol } from "@/lib/auth/route-guard";
import { CancelarRh, ResolverRh } from "./acciones";

/** Renglon de una solicitud. `modo`: mia (puede cancelar), jefe (visto bueno) o gerente (autoriza y puede cambiar el tipo). */
export function SolicitudFila({ s, modo, hoy }: { s: Solicitud; modo: "mia" | "jefe" | "gerente"; hoy: string }) {
  const abierta = s.estado === "pendiente" || s.estado === "visto_jefe";
  const titulo = s.tipo === "vacaciones" ? `Vacaciones · ${num(s.dias)} ${Number(s.dias) === 1 ? "día" : "días"}` : `Permiso · ${s.permiso_tipo ? PERMISO_LABEL[s.permiso_tipo] : ""}`;
  const puedeCancelar =
    modo === "mia" ? abierta || (s.estado === "aprobada" && s.desde > hoy) : modo === "gerente" ? abierta || s.estado === "aprobada" : s.sin_portal && abierta;
  const falta = s.estado === "pendiente" && s.jefe_rol ? `Falta visto bueno de ${JEFE_LABEL[s.jefe_rol].toLowerCase()}` : null;
  const diasRango = diasEntre(s.desde, s.hasta).filter((d) => isoDow(d) !== 7).length;
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {modo !== "mia" && (
            <p className="font-semibold">
              {s.nombre} <span className="text-xs font-normal text-slate-500">{s.puesto ?? (s.rol ? ROL_LABEL[s.rol as Rol] ?? s.rol : "")}</span>
              {s.sin_portal && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">SIN PORTAL</span>}
            </p>
          )}
          <p className={modo === "mia" ? "font-medium" : "text-sm"}>
            {titulo} <span className="text-slate-500">· {rangoRh(s.desde, s.hasta)}{s.hora ? ` · ${s.hora}` : ""}</span>
          </p>
          {s.motivo && <p className="text-xs text-slate-600">Motivo: {s.motivo}</p>}
          <p className="text-[11px] text-slate-400">
            Folio {s.folio} · pedida el {fechaRh(s.created_at.slice(0, 10))}
            {s.registro_nombre ? ` por ${s.registro_nombre}` : ""}
            {s.jefe_at && s.jefe_nombre ? ` · visto bueno de ${s.jefe_nombre}` : ""}
            {s.resuelto_nombre && !abierta ? ` · ${s.estado === "cancelada" ? "canceló" : "resolvió"} ${s.resuelto_nombre}` : ""}
            {s.tiene_evidencia && (
              <>
                {" · "}
                <a href={`/api/rrhh/evidencia/${s.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">
                  Ver evidencia
                </a>
              </>
            )}
          </p>
          {s.cambio && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{s.cambio}</p>}
          {s.comentario && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">Comentario: {s.comentario}</p>}
          {modo === "gerente" && falta && <p className="mt-1 text-xs text-amber-700">{falta} (puedes autorizar de todos modos)</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_COLOR[s.estado]}`}>{ESTADO_LABEL[s.estado]}</span>
          {puedeCancelar && <CancelarRh id={s.id} />}
        </div>
      </div>
      {abierta && modo === "jefe" && s.estado === "pendiente" && <ResolverRh id={s.id} visto aprobar={false} />}
      {abierta && modo === "gerente" && !s.mia && <ResolverRh id={s.id} visto={false} aprobar tipo={s.tipo} permisoTipo={s.permiso_tipo} dias={Number(s.dias)} diasRango={diasRango} />}
    </li>
  );
}
