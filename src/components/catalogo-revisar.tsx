"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { revisarComentarioCatalogoAction } from "@/actions/catalogo";

export function RevisarComentario({ id, revisado }: { id: string; revisado: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await revisarComentarioCatalogoAction(id, !revisado).catch(() => ({ ok: false as const, error: "Sin conexión" }));
          setBusy(false);
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${revisado ? "border border-slate-300 text-slate-600 hover:bg-slate-50" : "bg-brand-600 text-white hover:bg-brand-700"}`}
      >
        {busy ? "..." : revisado ? "Quitar revisado" : "Marcar revisado"}
      </button>
    </span>
  );
}
