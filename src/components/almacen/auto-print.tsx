"use client";

import { useEffect } from "react";

/** Abre la ventana de impresion en cuanto carga la pagina (una sola vez). */
export function AutoPrint() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("auto") !== "1") return;
    // Se quita "auto" para que al recargar o cambiar de formato no vuelva a abrirse sola.
    url.searchParams.delete("auto");
    window.history.replaceState(null, "", url.toString());
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
