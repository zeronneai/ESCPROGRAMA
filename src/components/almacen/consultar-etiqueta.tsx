"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Escaner, beep } from "@/components/almacen/escaner";
import { extraerCodigo } from "@/lib/almacen";

/** Escanear una etiqueta para ver su ficha (que es, cuando llego, si ya salio). */
export function ConsultarEtiqueta() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Escaner
        placeholder="Escanea una etiqueta para ver su información"
        onCodigo={(t) => {
          const c = extraerCodigo(t);
          if (!c) {
            beep(false);
            setErr("No es una etiqueta del sistema");
            return;
          }
          beep(true);
          setErr(null);
          router.push(`/almacen/etiqueta/${c}`);
        }}
      />
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}
