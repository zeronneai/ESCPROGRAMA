"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { buscarArticulosPlanAction, cancelarPedidoAction, crearPedidoAction } from "@/actions/pedidos";
import { toast } from "@/components/feedback-global";
import { Button } from "@/components/ui";
import { FRECUENCIAS, type Frecuencia } from "@/lib/pedidos";

type Art = { clave: string; nombre: string; um: string | null };

/** Formulario: el vendedor busca el articulo en el kardex (clave o nombre) o lo escribe como "otro". */
export function PedirArticulo() {
  const router = useRouter();
  const [pend, start] = useTransition();
  const [modo, setModo] = useState<"kardex" | "otro">("kardex");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Art[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [art, setArt] = useState<Art | null>(null);
  const [desc, setDesc] = useState("");
  const [um, setUm] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [frec, setFrec] = useState<Frecuencia>("unica");
  const [cliente, setCliente] = useState("");
  const [notas, setNotas] = useState("");
  const ultimo = useRef(0);

  useEffect(() => {
    if (modo !== "kardex" || art || q.trim().length < 2) {
      setRes([]);
      return;
    }
    const n = ++ultimo.current;
    const t = window.setTimeout(async () => {
      setBuscando(true);
      const r = await buscarArticulosPlanAction(q);
      if (n === ultimo.current) {
        setRes(r);
        setBuscando(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, modo, art]);

  const limpiar = () => {
    setArt(null); setQ(""); setDesc(""); setUm(""); setCantidad(""); setFrec("unica"); setCliente(""); setNotas("");
  };
  const enviar = () => {
    const c = Number(cantidad);
    if (modo === "kardex" && !art) return toast("Busca y elige el artículo, o usa \"Otro\" si no está.", "error");
    if (modo === "otro" && desc.trim().length < 2) return toast("Describe el producto que necesitas.", "error");
    if (!(c > 0)) return toast("Pon la cantidad.", "error");
    start(async () => {
      const r = await crearPedidoAction({
        clave: modo === "kardex" ? art!.clave : null,
        descripcion: modo === "kardex" ? art!.nombre : desc.trim(),
        cantidad: c,
        um: modo === "kardex" ? art!.um : um.trim() || null,
        frecuencia: frec,
        cliente: cliente.trim() || null,
        notas: notas.trim() || null,
      });
      if (!r.ok) return toast(r.error, "error");
      toast("Listo: el comprador ya ve tu pedido.", "success");
      limpiar();
      router.refresh();
    });
  };

  const inp = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {(["kardex", "otro"] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setModo(m); setArt(null); }} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${modo === m ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-400"}`}>
            {m === "kardex" ? "Artículo del kárdex" : "Otro (nuevo o de una cotización ganada)"}
          </button>
        ))}
      </div>

      {modo === "kardex" ? (
        art ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
            <div className="min-w-0">
              <p className="font-semibold text-brand-900">{art.clave}</p>
              <p className="text-sm text-slate-700">{art.nombre}{art.um ? ` · ${art.um}` : ""}</p>
            </div>
            <button type="button" className="shrink-0 text-sm text-brand-700 underline" onClick={() => { setArt(null); setQ(""); }}>Cambiar</button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700" htmlFor="buscar-art">Clave o nombre del artículo</label>
            <input id="buscar-art" className={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. ESC-1234 o guante nitrilo" autoComplete="off" />
            {buscando && <p className="text-xs text-slate-500">Buscando…</p>}
            {res.length > 0 && (
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {res.map((a) => (
                  <li key={a.clave}>
                    <button type="button" className="w-full px-3 py-2 text-left hover:bg-brand-50" onClick={() => { setArt(a); setRes([]); }}>
                      <span className="font-medium">{a.clave}</span>
                      <span className="block text-xs text-slate-500">{a.nombre}{a.um ? ` · ${a.um}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!buscando && q.trim().length >= 2 && !res.length && (
              <p className="text-sm text-slate-600">No lo encontré en el kárdex. <button type="button" className="text-brand-700 underline" onClick={() => { setModo("otro"); setDesc(q); }}>Pedirlo como &quot;otro&quot;</button></p>
            )}
          </div>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <label className="block text-sm font-medium text-slate-700">
            ¿Qué producto necesitas?
            <input className={`${inp} mt-1`} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción, marca, medida, número de parte…" maxLength={400} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Unidad
            <input className={`${inp} mt-1`} value={um} onChange={(e) => setUm(e.target.value)} placeholder="Pieza, caja…" maxLength={30} />
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          Cantidad
          <input className={`${inp} mt-1`} type="number" min={0} inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
        </label>
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
          ¿Cada cuándo?
          <select className={`${inp} mt-1`} value={frec} onChange={(e) => setFrec(e.target.value as Frecuencia)}>
            {(Object.keys(FRECUENCIAS) as Frecuencia[]).map((f) => <option key={f} value={f}>{FRECUENCIAS[f]}</option>)}
          </select>
        </label>
      </div>
      <p className="-mt-1 text-xs text-slate-500">
        {frec === "unica"
          ? "Pedido especial: en cuanto el comprador lo meta en una orden de compra, aquí te aparece el folio y cuándo llega."
          : "Se suma a lo que el comprador planea en cada orden mientras lo tengas activo. Pide solo lo nuevo (un cliente nuevo o que va a comprar más de lo normal): lo que ya se vende normalmente ya lo cuenta la planeación."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Cliente o cotización (opcional)
          <input className={`${inp} mt-1`} value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Para quién es" maxLength={200} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Notas para el comprador (opcional)
          <input className={`${inp} mt-1`} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Fecha que lo necesita, color, etc." maxLength={1000} />
        </label>
      </div>
      <Button type="button" onClick={enviar} loading={pend}>Mandar pedido al comprador</Button>
    </div>
  );
}

export function CancelarPedido({ id }: { id: string }) {
  const router = useRouter();
  const [pend, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pend}
      className="text-xs font-medium text-red-700 underline disabled:opacity-50"
      onClick={() =>
        start(async () => {
          const r = await cancelarPedidoAction(id);
          if (!r.ok) return toast(r.error, "error");
          toast("Pedido cancelado", "success");
          router.refresh();
        })
      }
    >
      {pend ? "Cancelando…" : "Cancelar"}
    </button>
  );
}
