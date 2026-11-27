"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelarRhAction, resolverRhAction } from "@/actions/rrhh";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { PERMISO_LABEL, type PermisoTipo, type TipoSolicitud } from "@/lib/rrhh";

/** Visto bueno (jefe), autorizar (gerente, puede cambiar permiso <-> vacaciones y los dias) o no autorizar. */
export function ResolverRh({ id, visto, aprobar, tipo = "permiso", permisoTipo = null, dias = 0, diasRango = null }: { id: string; visto: boolean; aprobar: boolean; tipo?: TipoSolicitud; permisoTipo?: PermisoTipo | null; dias?: number; diasRango?: number | null }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [com, setCom] = useState("");
  const [como, setComo] = useState<TipoSolicitud>(tipo);
  const [pt, setPt] = useState<PermisoTipo>(permisoTipo ?? "ausentarse");
  const [d, setD] = useState(String(tipo === "vacaciones" ? dias : (diasRango ?? 1)));
  const hacer = (accion: "visto" | "aprobar" | "rechazar") =>
    start(async () => {
      const r = await resolverRhAction(id, accion, com, accion === "aprobar" ? { tipo: como, permiso_tipo: como === "permiso" ? pt : null, dias: como === "vacaciones" ? Number(d) : null } : undefined);
      if (!r.ok) return toast(r.error, "error");
      toast(accion === "rechazar" ? "Se avisó que no se autorizó." : accion === "visto" ? "Visto bueno dado: ahora la autoriza la gerente." : "Autorizada.", "success");
      setCom("");
      router.refresh();
    });
  const sel = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <div className="space-y-2">
      {aprobar && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">Autorizar como</span>
          <select className={sel} value={como} onChange={(e) => setComo(e.target.value as TipoSolicitud)}>
            <option value="vacaciones">Vacaciones (descuenta días)</option>
            <option value="permiso">Permiso (no descuenta)</option>
          </select>
          {como === "vacaciones" ? (
            <label className="flex items-center gap-1.5">
              <input type="number" min={0} max={60} step={0.5} value={d} onChange={(e) => setD(e.target.value)} className={`${sel} w-20`} />
              <span className="text-slate-600">días</span>
            </label>
          ) : (
            <select className={sel} value={pt} onChange={(e) => setPt(e.target.value as PermisoTipo)}>
              {(Object.keys(PERMISO_LABEL) as PermisoTipo[]).map((k) => <option key={k} value={k}>{PERMISO_LABEL[k]}</option>)}
            </select>
          )}
          {como !== tipo && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Se cambia de {tipo === "vacaciones" ? "vacaciones a permiso" : "permiso a vacaciones"}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input value={com} onChange={(e) => setCom(e.target.value)} maxLength={500} placeholder="Comentario (opcional)" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm sm:w-auto sm:min-w-0 sm:max-w-xs sm:flex-1" />
        {visto && (
          <Button variant="secondary" loading={pend} onClick={() => hacer("visto")} className="border-green-500 text-green-700">
            ✓ Visto bueno
          </Button>
        )}
        {aprobar && (
          <Button variant="secondary" loading={pend} onClick={() => hacer("aprobar")} className="border-green-500 text-green-700">
            ✓ Autorizar
          </Button>
        )}
        <Button variant="secondary" loading={pend} onClick={() => hacer("rechazar")} className="border-red-300 text-red-700">
          ✗ No autorizar
        </Button>
      </div>
    </div>
  );
}

export function CancelarRh({ id }: { id: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [seguro, setSeguro] = useState(false);
  if (!seguro) {
    return (
      <button type="button" onClick={() => setSeguro(true)} className="text-xs font-medium text-slate-500 underline hover:text-red-600">
        Cancelar
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      ¿Cancelar?
      <button
        type="button"
        disabled={pend}
        className="font-semibold text-red-600 underline"
        onClick={() =>
          start(async () => {
            const r = await cancelarRhAction(id);
            if (!r.ok) return toast(r.error, "error");
            toast("Solicitud cancelada.", "success");
            router.refresh();
          })
        }
      >
        Sí
      </button>
      <button type="button" className="text-slate-500 underline" onClick={() => setSeguro(false)}>
        No
      </button>
    </span>
  );
}
