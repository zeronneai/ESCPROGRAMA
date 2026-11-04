"use client";

import { useState } from "react";
import { deleteOcAction, ocCerrarAction } from "@/actions/pagos";
import { OcForm, type ProvOpcion } from "@/components/pagos/oc-form";
import { useRun } from "@/components/ops-ui";
import { Alert, Button } from "@/components/ui";
import type { OcRow } from "@/lib/pagos";

/** Comprador: editar, cerrar o borrar la OC. */
export function OcAcciones({ oc, proveedores, today, sinPagos }: { oc: OcRow; proveedores: ProvOpcion[]; today: string; sinPagos: boolean }) {
  const [edit, setEdit] = useState(false);
  const { run, busy, notice, router } = useRun();
  if (edit) return <OcForm oc={oc} proveedores={proveedores} today={today} onDone={() => setEdit(false)} />;
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="text-xs" onClick={() => setEdit(true)}>Editar OC</Button>
        <Button variant="ghost" className="text-xs" disabled={!!busy} onClick={() => run("c", () => ocCerrarAction(oc.id, !oc.cerrada_at), oc.cerrada_at ? "OC reabierta." : "OC cerrada.")}>
          {oc.cerrada_at ? "Reabrir OC" : "Cerrar OC"}
        </Button>
        {sinPagos && (
          <Button variant="ghost" className="text-xs text-red-700" disabled={!!busy} onClick={() => { if (window.confirm("¿Borrar esta OC?")) run("d", () => deleteOcAction(oc.id), (r) => { if (r.ok) router.push("/pagos"); }); }}>
            Borrar OC
          </Button>
        )}
      </div>
    </div>
  );
}
