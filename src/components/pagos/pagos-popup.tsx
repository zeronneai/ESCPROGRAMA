"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Ventana de aviso al entrar: pagos por hacer (CEO) o comprobantes por descargar (comprador). Una vez por sesion. */
export function PagosPopup({ clave, titulo, lineas, cta }: { clave: string; titulo: string; lineas: string[]; cta: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => {
    let visto = false;
    try {
      visto = sessionStorage.getItem("esc-pagos-aviso") === clave;
    } catch {
      visto = false;
    }
    if (!visto && !path.startsWith("/pagos")) setOpen(true);
  }, [clave, path]);
  const cerrar = () => {
    setOpen(false);
    try {
      sessionStorage.setItem("esc-pagos-aviso", clave);
    } catch {
      /* sin almacenamiento: solo se cierra */
    }
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div role="alertdialog" aria-modal="true" aria-label={titulo} className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-700">$</span>
          <p className="text-lg font-semibold text-slate-900">{titulo}</p>
        </div>
        <ul className="space-y-1 text-sm text-slate-700">{lineas.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="flex gap-2 pt-1">
          <Link href="/pagos" onClick={cerrar} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{cta}</Link>
          <button type="button" onClick={cerrar} className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Más tarde</button>
        </div>
      </div>
    </div>
  );
}
