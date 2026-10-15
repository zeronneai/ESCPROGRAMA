"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markPurchasedAction } from "@/actions/sourcing";
import { Button } from "@/components/ui";

export function PurchaseButton({ itemId, compradaAt, por }: { itemId: string; compradaAt: string | null; por: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1 text-xs">
      {compradaAt ? (
        <p className="text-green-700">Comprada el {new Date(compradaAt).toLocaleDateString("es-MX", { dateStyle: "medium" })}{por ? ` por ${por}` : ""}</p>
      ) : (
        <p className="text-amber-800">Por comprar</p>
      )}
      <Button
        variant={compradaAt ? "ghost" : "secondary"}
        className="px-2 py-1 text-xs"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await markPurchasedAction(itemId, !compradaAt);
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }
      >
        {compradaAt ? "Quitar marca" : "Marcar comprada"}
      </Button>
      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}
