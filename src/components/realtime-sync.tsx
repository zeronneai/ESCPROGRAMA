"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Tiempo real en todo el portal: cuando alguien crea o cambia algo (una factura, una guia, una
 * solicitud, un pago...) la pagina abierta se actualiza sola, sin recargar. Cada quien solo recibe
 * los cambios que puede ver (Supabase respeta los permisos). Si el tiempo real no esta disponible,
 * se actualiza al volver a la pestaña y cada 2 minutos.
 */
const TABLAS = [
  "notifications",
  "quote_requests", "quote_items", "item_quotes", "item_messages", "item_purchases", "item_dispatch", "item_outcomes", "item_update_requests", "quote_issues",
  "guias", "guia_eventos",
  "ventas", "customers", "bitacora", "leads",
  "salidas", "salida_lineas", "recepciones", "etiquetas",
  "pagos", "ordenes_compra",
  "consumo_solicitudes", "quejas", "acciones_correctivas", "calidad_eventos", "control_cambios", "documentos", "minutas", "encuestas_cliente", "riesgo_analisis",
  "pegatron_oc", "pegatron_oc_lineas", "catalogo_comentarios",
];

/** Evento que avisan otros componentes (ej. la campana de notificaciones). */
export const EVENTO_CAMBIO = "esc:cambio";

export function RealtimeSync() {
  const router = useRouter();
  const pendiente = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const ultimo = useRef(0);

  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState !== "visible") {
        pendiente.current = true;
        return;
      }
      pendiente.current = false;
      ultimo.current = Date.now();
      router.refresh();
    };
    // Varios cambios juntos (ej. escanear 10 cajas) = una sola actualizacion.
    const programar = (tabla: string) => {
      window.dispatchEvent(new CustomEvent(EVENTO_CAMBIO, { detail: tabla }));
      window.clearTimeout(timer.current);
      const espera = Math.max(800, 2500 - (Date.now() - ultimo.current));
      timer.current = window.setTimeout(refrescar, espera);
    };

    const sb = createClient();
    const canal = sb.channel("portal-tiempo-real");
    for (const t of TABLAS) canal.on("postgres_changes", { event: "*", schema: "public", table: t }, () => programar(t));
    canal.subscribe();

    const alVolver = () => {
      if (document.visibilityState === "visible" && (pendiente.current || Date.now() - ultimo.current > 60_000)) refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);
    const respaldo = window.setInterval(() => document.visibilityState === "visible" && refrescar(), 120_000);
    return () => {
      window.clearTimeout(timer.current);
      window.clearInterval(respaldo);
      document.removeEventListener("visibilitychange", alVolver);
      void sb.removeChannel(canal);
    };
  }, [router]);

  return null;
}
