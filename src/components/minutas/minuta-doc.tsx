import type { Rol } from "@/lib/auth/route-guard";
import { fechaMx, horaCorta, type MinutaFirma, type MinutaRow } from "@/lib/minutas";
import { ROL_LABEL } from "@/lib/ops/roles";

const th = "border border-slate-300 bg-slate-100 px-2 py-1.5 text-left text-xs font-semibold text-slate-700";
const td = "border border-slate-300 px-2 py-1.5 align-top text-sm";
const firmaTxt = (d: string) =>
  `Firmó en el portal ${new Date(d).toLocaleString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chihuahua" })}`;

function Titulo({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-1.5 text-sm font-bold uppercase tracking-wide text-slate-800">{children}</h3>;
}

/** Minuta con la estructura del formato: datos, asistencia, agenda, desarrollo, compromisos y proxima reunion. */
export function MinutaDoc({ m, firmas, paraImprimir = false }: { m: MinutaRow; firmas: MinutaFirma[]; paraImprimir?: boolean }) {
  const puntos = m.desarrollo ?? [];
  const compromisos = puntos.filter((p) => p.actividad?.trim());
  const externos = m.externos ?? [];
  return (
    <div className="text-slate-900">
      <table className="w-full border-collapse">
        <tbody>
          <tr><td className={`${td} w-40 font-semibold`}>Reunión</td><td className={td} colSpan={3}>{m.tema}</td></tr>
          <tr><td className={`${td} font-semibold`}>Responsable</td><td className={td} colSpan={3}>{m.responsable ?? ""}</td></tr>
          <tr><td className={`${td} font-semibold`}>Lugar o enlace virtual</td><td className={td} colSpan={3}>{m.lugar ?? ""}</td></tr>
          <tr>
            <td className={`${td} font-semibold`}>Fecha</td><td className={td}>{fechaMx(m.fecha)}</td>
            <td className={`${td} w-32 font-semibold`}>Hora</td><td className={td}>{horaCorta(m.hora_inicio)}{m.hora_fin && ` a ${horaCorta(m.hora_fin)}`}</td>
          </tr>
        </tbody>
      </table>

      <Titulo>Asistencia</Titulo>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Participante</th><th className={th}>Puesto</th><th className={th}>Correo</th><th className={`${th} w-48`}>Firma</th></tr></thead>
        <tbody>
          {firmas.map((f) => (
            <tr key={f.user_id}>
              <td className={td}>{f.nombre}</td>
              <td className={td}>{ROL_LABEL[f.puesto as Rol] ?? f.puesto}</td>
              <td className={`${td} break-all`}>{f.correo}</td>
              <td className={`${td} ${paraImprimir ? "h-10" : ""}`}>{f.firmada_at ? <span className="text-xs text-green-800">{firmaTxt(f.firmada_at)}</span> : paraImprimir ? "" : <span className="text-xs text-amber-800">Pendiente</span>}</td>
            </tr>
          ))}
          {externos.map((x, i) => (
            <tr key={`x${i}`}>
              <td className={td}>{x.nombre}</td>
              <td className={td}>{x.puesto}</td>
              <td className={`${td} break-all`}>{x.correo}</td>
              <td className={`${td} ${paraImprimir ? "h-10" : ""}`}>{paraImprimir ? "" : <span className="text-xs text-slate-500">Firma en papel</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Titulo>Agenda</Titulo>
      <table className="w-full border-collapse">
        <thead><tr><th className={`${th} w-10`}>No.</th><th className={th}>Tema</th><th className={`${th} w-48`}>Responsable</th></tr></thead>
        <tbody>
          {puntos.map((p, i) => (
            <tr key={i}><td className={td}>{i + 1}</td><td className={td}>{p.tema}</td><td className={td}>{p.aplica}</td></tr>
          ))}
        </tbody>
      </table>

      <Titulo>Desarrollo</Titulo>
      <table className="w-full border-collapse">
        <thead><tr><th className={`${th} w-10`}>No.</th><th className={`${th} w-48`}>Tema</th><th className={th}>Desarrollo</th></tr></thead>
        <tbody>
          {puntos.map((p, i) => (
            <tr key={i}><td className={td}>{i + 1}</td><td className={td}>{p.tema}</td><td className={`${td} whitespace-pre-wrap`}>{p.explicacion}</td></tr>
          ))}
        </tbody>
      </table>

      <Titulo>Actividades a realizar / Compromisos</Titulo>
      {compromisos.length === 0 ? (
        <p className="text-sm text-slate-500">Sin compromisos.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead><tr><th className={`${th} w-10`}>No.</th><th className={`${th} w-40`}>Tema</th><th className={th}>Actividad</th><th className={`${th} w-40`}>Responsable</th><th className={`${th} w-28`}>Fecha</th></tr></thead>
          <tbody>
            {compromisos.map((p, i) => (
              <tr key={i}><td className={td}>{i + 1}</td><td className={td}>{p.tema}</td><td className={`${td} whitespace-pre-wrap`}>{p.actividad}</td><td className={td}>{p.aplica}</td><td className={td}>{p.fecha ? fechaMx(p.fecha) : ""}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <Titulo>Próxima reunión</Titulo>
      <table className="w-full border-collapse">
        <tbody>
          <tr><td className={`${td} w-40 font-semibold`}>Tema</td><td className={td} colSpan={3}>{m.proxima_tema ?? ""}</td></tr>
          <tr>
            <td className={`${td} font-semibold`}>Fecha</td><td className={td}>{fechaMx(m.proxima_fecha)}</td>
            <td className={`${td} w-32 font-semibold`}>Hora</td><td className={td}>{horaCorta(m.proxima_hora)}</td>
          </tr>
          <tr><td className={`${td} font-semibold`}>Lugar o enlace</td><td className={td} colSpan={3}>{m.proxima_lugar ?? ""}</td></tr>
        </tbody>
      </table>

      <p className="mt-5 text-sm"><span className="font-semibold">Realizó minuta:</span> {m.created_by_nombre}</p>
    </div>
  );
}
