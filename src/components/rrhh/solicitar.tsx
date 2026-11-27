"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { contarDiasRhAction, solicitarRhAction } from "@/actions/rrhh";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { num, PERMISO_LABEL, type PermisoTipo, type TipoSolicitud } from "@/lib/rrhh";

const inp = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

/** Formulario unico: vacaciones (descuenta dias) o permiso (llegar tarde, salir temprano, ausentarse). */
export function SolicitarRh({ disponible, capturado, hoy, anticipacion, adelanto }: { disponible: number | null; capturado: boolean; hoy: string; anticipacion: number; adelanto: number }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [tipo, setTipo] = useState<TipoSolicitud>(capturado ? "vacaciones" : "permiso");
  const [ptipo, setPtipo] = useState<PermisoTipo>("llegar_tarde");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [hora, setHora] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dias, setDias] = useState<number | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const ultimo = useRef(0);

  useEffect(() => {
    if (tipo !== "vacaciones" || !desde) {
      setDias(null);
      return;
    }
    const fin = hasta && hasta >= desde ? hasta : desde;
    const n = ++ultimo.current;
    const t = window.setTimeout(async () => {
      const r = await contarDiasRhAction(desde, fin);
      if (n === ultimo.current) setDias(r);
    }, 200);
    return () => window.clearTimeout(t);
  }, [tipo, desde, hasta]);

  const minVac = (() => {
    const d = new Date(hoy + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + anticipacion);
    return d.toISOString().slice(0, 10);
  })();
  const excede = tipo === "vacaciones" && dias !== null && disponible !== null && dias > disponible + adelanto;

  const enviar = () => {
    if (!desde) return toast(tipo === "vacaciones" ? "Elige desde qué día." : "Elige el día del permiso.", "error");
    if (tipo === "vacaciones" && hasta && hasta < desde) return toast("La fecha final es antes de la inicial.", "error");
    if (tipo === "permiso" && motivo.trim().length < 3) return toast("Escribe el motivo del permiso.", "error");
    const fd = new FormData();
    fd.set(
      "datos",
      JSON.stringify({
        tipo,
        permiso_tipo: tipo === "permiso" ? ptipo : null,
        desde,
        hasta: tipo === "vacaciones" ? hasta || desde : ptipo === "ausentarse" ? hasta || desde : desde,
        hora: tipo === "permiso" ? hora.trim() || null : null,
        motivo: motivo.trim() || null,
      }),
    );
    const f = archivo.current?.files?.[0];
    if (f) fd.set("evidencia", f);
    start(async () => {
      const r = await solicitarRhAction(fd);
      if (!r.ok) return toast(r.error, "error");
      toast("Listo: tu solicitud se mandó para autorizar.", "success");
      setDesde(""); setHasta(""); setHora(""); setMotivo(""); setDias(null);
      if (archivo.current) archivo.current.value = "";
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {(["vacaciones", "permiso"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTipo(t)} className={`rounded-full border px-4 py-1.5 text-sm font-medium ${tipo === t ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-400"}`}>
            {t === "vacaciones" ? "Vacaciones" : "Permiso"}
          </button>
        ))}
      </div>

      {tipo === "vacaciones" && !capturado ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Para pedir vacaciones, la gerente primero tiene que capturar tu fecha de ingreso y tus días. Los permisos sí los puedes pedir.</p>
      ) : (
        <>
          {tipo === "permiso" && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PERMISO_LABEL) as PermisoTipo[]).map((k) => (
                <button key={k} type="button" onClick={() => setPtipo(k)} className={`rounded-lg border px-3 py-1.5 text-sm ${ptipo === k ? "border-brand-500 bg-brand-50 font-semibold text-brand-800" : "border-slate-300 text-slate-700 hover:border-brand-300"}`}>
                  {PERMISO_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{tipo === "vacaciones" ? "Desde" : ptipo === "ausentarse" ? "Desde el día" : "Día"}</span>
              <input type="date" className={inp} value={desde} min={tipo === "vacaciones" ? minVac : undefined} onChange={(e) => setDesde(e.target.value)} />
            </label>
            {(tipo === "vacaciones" || ptipo === "ausentarse") && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Hasta (incluido)</span>
                <input type="date" className={inp} value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
              </label>
            )}
            {tipo === "permiso" && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Hora</span>
                <input className={inp} value={hora} maxLength={40} placeholder={ptipo === "llegar_tarde" ? "Llego a las 10:30" : ptipo === "salir_temprano" ? "Salgo a las 4:00" : "Todo el día / de 12 a 2"} onChange={(e) => setHora(e.target.value)} />
              </label>
            )}
          </div>
          {tipo === "vacaciones" && dias !== null && (
            <p className={`rounded-lg px-3 py-2 text-sm ${excede ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-800"}`}>
              Se descuentan <b>{dias}</b> {dias === 1 ? "día" : "días"} (no cuentan domingos, festivos ni vacaciones generales).
              {disponible !== null && <> Tienes <b>{num(disponible)}</b> disponibles{excede ? ", no te alcanzan." : "."}</>}
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Motivo{tipo === "vacaciones" ? " (opcional)" : ""}</span>
            <textarea className={inp} rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Evidencia (opcional: receta, cita, comprobante)</span>
            <input ref={archivo} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={enviar} loading={pend} disabled={excede}>
              {tipo === "vacaciones" ? "Pedir vacaciones" : "Pedir permiso"}
            </Button>
            {tipo === "vacaciones" && anticipacion > 0 && <span className="text-xs text-slate-500">Se piden con al menos {anticipacion} días de anticipación.</span>}
          </div>
        </>
      )}
    </div>
  );
}
