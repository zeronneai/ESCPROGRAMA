"use client";
import { useState } from "react";

/** Usa /public/logo-esc.png; si no existe, muestra un placeholder. */
export function Logo({ className = "h-8" }: { className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="rounded bg-brand-900 px-2 py-1 text-sm font-bold tracking-wide text-white">ESC</span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo-esc.png" alt="ESC Representaciones" className={className} onError={() => setBroken(true)} />;
}
