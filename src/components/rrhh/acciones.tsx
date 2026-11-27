"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelarRhAction, resolverRhAction } from "@/actions/rrhh";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";

/** Visto bueno (jefe), autorizar (gerente) o no autorizar, con comentario opcional. */
export function ResolverRh({ id, visto, aprobar }: { id: string; visto: boolean; aprobar: boolean }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [com, setCom] = useState("");
  const hacer = (accion: "visto" | "aprobar" | "rechazar") =>
    start(async () => {
      const r = await resolverRhAction(id, accion, com);
      if (!r.ok) return toast(r.error, "error");
      toast(accion === "rechazar" ? "Se avisó que no se autorizó." : accion === "visto" ? "Visto bueno dado: ahora la autoriza la gerente." : "Autorizada.", "success");
      setCom("");
      router.refresh();
    });
  return (
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
