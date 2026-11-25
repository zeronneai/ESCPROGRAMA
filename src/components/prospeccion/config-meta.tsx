"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { guardarMetaProspeccionAction, tipoProspeccionAction } from "@/actions/meta-prospeccion";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { TIPOS_PROSPECCION, type TipoProspeccion } from "@/lib/meta-prospeccion";

export function ConfigMeta({ tele, campo, inicio }: { tele: number; campo: number; inicio: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [t, setT] = useState(String(tele));
  const [c, setC] = useState(String(campo));
  const [i, setI] = useState(inicio);
  const inp = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="w-40 text-sm font-medium text-slate-700">Telemarketing (por día)<input className={inp} type="number" min={0} max={200} value={t} onChange={(e) => setT(e.target.value)} /></label>
      <label className="w-40 text-sm font-medium text-slate-700">Campo (por día)<input className={inp} type="number" min={0} max={200} value={c} onChange={(e) => setC(e.target.value)} /></label>
      <label className="w-44 text-sm font-medium text-slate-700">Contar desde<input className={inp} type="date" value={i} onChange={(e) => setI(e.target.value)} /></label>
      <Button
        type="button"
        loading={pend}
        onClick={() =>
          start(async () => {
            const r = await guardarMetaProspeccionAction({ meta_telemarketing: Math.round(Number(t)), meta_campo: Math.round(Number(c)), inicio: i });
            if (!r.ok) return toast(r.error, "error");
            toast("Meta guardada", "success");
            router.refresh();
          })
        }
      >
        Guardar meta
      </Button>
    </div>
  );
}

export function TipoVendedor({ id, tipo }: { id: string; tipo: TipoProspeccion }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  return (
    <select
      aria-label="Tipo de vendedor"
      disabled={pend}
      className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
      value={tipo}
      onChange={(e) =>
        start(async () => {
          const r = await tipoProspeccionAction(id, e.target.value);
          if (!r.ok) return toast(r.error, "error");
          router.refresh();
        })
      }
    >
      {(Object.keys(TIPOS_PROSPECCION) as TipoProspeccion[]).map((k) => <option key={k} value={k}>{TIPOS_PROSPECCION[k]}</option>)}
    </select>
  );
}
