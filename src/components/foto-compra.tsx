"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { quitarFotoCompraAction, subirFotoCompraAction, urlFotoCompraAction } from "@/actions/foto-compra";

/**
 * Imagen de confirmacion de la partida: el comprador la sube y el vendedor la descarga para mandarla
 * al cliente por separado. No va en el PDF de la cotizacion.
 */
export function FotoCompra({ itemId, requestId, nombre, puedeSubir }: { itemId: string; requestId: string; nombre: string | null; puedeSubir: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<string | null>(null);

  if (!nombre && !puedeSubir) return null;

  async function abrir(descargar: boolean) {
    setError(null);
    setBusy(descargar ? "bajar" : "ver");
    const r = await urlFotoCompraAction(itemId, descargar);
    setBusy(null);
    if ("error" in r) return setError(r.error);
    if (descargar) window.location.href = r.url;
    else setVista(r.url);
  }
  async function subir(f: File | null) {
    if (!f) return;
    setError(null);
    setBusy("subir");
    const fd = new FormData();
    fd.set("file", f);
    fd.set("itemId", itemId);
    fd.set("requestId", requestId);
    const r = await subirFotoCompraAction(fd);
    setBusy(null);
    if (input.current) input.current.value = "";
    if (!r.ok) return setError(r.error);
    setVista(null);
    router.refresh();
  }

  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-sky-900">Imagen de confirmación</p>
          <p className="text-xs text-sky-900/80">
            {nombre
              ? puedeSubir ? `Subida: ${nombre}. El vendedor la puede descargar.` : "Compras subió una imagen del producto. Descárgala para mandarla aparte al cliente (no va en el PDF)."
              : "Opcional: sube una foto del producto como confirmación. El vendedor la descarga aparte; no va en el PDF."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {nombre && <button type="button" className={btn} disabled={!!busy} onClick={() => (vista ? setVista(null) : void abrir(false))}>{busy === "ver" ? "Abriendo..." : vista ? "Ocultar" : "Ver"}</button>}
          {nombre && <button type="button" className={btn} disabled={!!busy} onClick={() => void abrir(true)}>{busy === "bajar" ? "Descargando..." : "Descargar"}</button>}
          {puedeSubir && (
            <>
              <button type="button" className={btn} disabled={!!busy} onClick={() => input.current?.click()}>{busy === "subir" ? "Subiendo..." : nombre ? "Cambiar imagen" : "Subir imagen"}</button>
              {nombre && (
                <button type="button" className={`${btn} text-red-700`} disabled={!!busy} onClick={async () => {
                  setBusy("quitar");
                  const r = await quitarFotoCompraAction(itemId, requestId);
                  setBusy(null);
                  if (!r.ok) return setError(r.error);
                  setVista(null);
                  router.refresh();
                }}>Quitar</button>
              )}
              <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void subir(e.target.files?.[0] ?? null)} />
            </>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
      {vista && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={vista} alt="Imagen de confirmación" className="mt-3 max-h-80 rounded-md border border-sky-200 bg-white object-contain" />
      )}
    </div>
  );
}
