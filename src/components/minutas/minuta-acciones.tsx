"use client";

import { enviarMinutaAction, firmarMinutaAction } from "@/actions/minutas";
import { useRun } from "@/components/ops-ui";
import { Alert, Button } from "@/components/ui";

export function FirmarMinuta({ id }: { id: string }) {
  const { run, busy, notice } = useRun();
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Button loading={busy === "f"} onClick={() => run("f", () => firmarMinutaAction(id), "Firmada. Queda registrado con fecha y hora.")}>
        Firmar de enterado
      </Button>
    </div>
  );
}

export function EnviarMinuta({ id }: { id: string }) {
  const { run, busy, notice } = useRun();
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Button loading={busy === "s"} onClick={() => run("s", () => enviarMinutaAction(id), "Enviada. Se avisó a cada persona que debe firmar.")}>
        Enviar a firmas
      </Button>
    </div>
  );
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
      Imprimir
    </button>
  );
}
