"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Logo de ESC: /public/logo-esc.png (333 x 96).
 * El respaldo "ESC" solo aparece si la imagen falla DOS veces: el segundo intento
 * evita que un fallo transitorio o una respuesta vieja en cache deje el respaldo fijo.
 */
export function Logo({ className = "h-8" }: { className?: string }) {
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLImageElement>(null);

  // Si la imagen fallo ANTES de la hidratacion, React nunca recibe el evento onError:
  // se revisa el estado real del elemento al montar.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setAttempt((a) => a + 1);
  }, [attempt]);

  if (attempt >= 2) {
    return (
      <span className="rounded bg-brand-900 px-2 py-1 text-sm font-bold tracking-wide text-white">ESC</span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      key={attempt}
      src={attempt === 0 ? "/logo-esc.png" : `/logo-esc.png?reintento=${attempt}`}
      alt="ESC Representaciones"
      width={333}
      height={96}
      className={`${className} w-auto`}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}
