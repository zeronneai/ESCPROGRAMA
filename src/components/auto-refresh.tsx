"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarga los datos de la pagina cada cierto tiempo (para que las alarmas por tiempo se actualicen solas). */
export function AutoRefresh({ segundos = 60 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1000);
    return () => window.clearInterval(t);
  }, [router, segundos]);
  return null;
}
