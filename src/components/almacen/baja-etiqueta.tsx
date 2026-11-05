"use client";

import { useState } from "react";
import { bajaEtiquetaAction } from "@/actions/almacen";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Input } from "@/components/ui";

export function BajaEtiqueta({ codigo }: { codigo: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { run, busy, notice } = useRun();
  return (
    <Card className="space-y-2 p-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {!abierto ? (
        <Button variant="ghost" className="text-sm text-red-700" onClick={() => setAbierto(true)}>Dar de baja (dañada, extraviada, merma)</Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la baja" />
          <Button className="bg-red-600 hover:bg-red-700" loading={busy === "b"} disabled={motivo.trim().length < 3} onClick={() => run("b", () => bajaEtiquetaAction(codigo, motivo), "Etiqueta dada de baja: ya no cuenta en el inventario.")}>Dar de baja</Button>
        </div>
      )}
    </Card>
  );
}
