import { ROL_LABEL } from "@/lib/ops/roles";
import { ESTADO_COLOR, ESTADO_LABEL, fechaRh, num, PERMISO_LABEL, rangoRh, type Solicitud } from "@/lib/rrhh";
import type { Rol } from "@/lib/auth/route-guard";
import { CancelarRh, ResolverRh } from "./acciones";

/** Renglon de una solicitud. `modo`: mia (puede cancelar), jefe (visto bueno) o gerente (autoriza). */
export function SolicitudFila({ s, modo, hoy }: { s: Solicitud; modo: "mia" | "jefe" | "gerente"; hoy: string }) {
  const abierta = s.estado === "pendiente" || s.estado === "visto_jefe";
  const titulo = s.tipo === "vacaciones" ? `Vacaciones · ${num(s.dias)} ${Number(s.dias) === 1 ? "día" : "días"}` : `Permiso · ${s.permiso_tipo ? PERMISO_LABEL[s.permiso_tipo] : ""}`;
  const puedeCancelar = modo === "mia" ? abierta || (s.estado === "aprobada" && s.desde > hoy) : modo === "gerente" && (abierta || s.estado === "aprobada");
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {modo !== "mia" && (
            <p className="font-semibold">
              {s.nombre} <span className="text-xs font-normal text-slate-500">{s.puesto ?? ROL_LABEL[s.rol as Rol] ?? s.rol}</span>
            </p>
          )}
          <p className={modo === "mia" ? "font-medium" : "text-sm"}>
            {titulo} <span className="text-slate-500">· {rangoRh(s.desde, s.hasta)}{s.hora ? ` · ${s.hora}` : ""}</span>
          </p>
          {s.motivo && <p className="text-xs text-slate-600">Motivo: {s.motivo}</p>}
          <p className="text-[11px] text-slate-400">
            Folio {s.folio} · pedida el {fechaRh(s.created_at.slice(0, 10))}
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
          {s.comentario && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">Comentario: {s.comentario}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_COLOR[s.estado]}`}>{ESTADO_LABEL[s.estado]}</span>
          {puedeCancelar && <CancelarRh id={s.id} />}
        </div>
      </div>
      {abierta && modo === "jefe" && s.estado === "pendiente" && <ResolverRh id={s.id} visto aprobar={false} />}
      {abierta && modo === "gerente" && !s.mia && <ResolverRh id={s.id} visto={false} aprobar />}
    </li>
  );
}
