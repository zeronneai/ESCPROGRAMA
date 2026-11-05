"use client";

import { useState } from "react";
import { cancelarSalidaAction, escanearAction, quitarEscaneoAction, terminarSalidaAction, type Escaneo } from "@/actions/almacen";
import { Escaner, beep } from "@/components/almacen/escaner";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Input } from "@/components/ui";
import type { SalidaLinea } from "@/lib/almacen";

type Cargada = { codigo: string; clave: string };

/** Carga del camion: escanear cada etiqueta contra la factura. */
export function CargaPanel({ salidaId, lineas: ini, cargadas: iniCargadas }: { salidaId: string; lineas: SalidaLinea[]; cargadas: Cargada[] }) {
  const [lineas, setLineas] = useState(ini);
  const [cargadas, setCargadas] = useState<Cargada[]>(iniCargadas);
  const [ultimo, setUltimo] = useState<Escaneo | null>(null);
  const [cerrar, setCerrar] = useState<"terminar" | "cancelar" | null>(null);
  const [nota, setNota] = useState("");
  const { run, busy, notice, router } = useRun();
  const conClave = lineas.filter((l) => l.articulo_id);
  const faltan = conClave.reduce((a, l) => a + (l.cantidad - l.escaneadas), 0);
  const total = conClave.reduce((a, l) => a + l.cantidad, 0);

  async function escanear(texto: string) {
    const r = await escanearAction(salidaId, texto);
    setUltimo(r);
    beep(r.ok);
    if (r.ok && r.clave && r.codigo) {
      setCargadas((c) => [{ codigo: r.codigo!, clave: r.clave! }, ...c]);
      setLineas((ls) => {
        let hecho = false;
        return ls.map((l) => {
          if (!hecho && l.clave === r.clave && l.escaneadas < l.cantidad) {
            hecho = true;
            return { ...l, escaneadas: l.escaneadas + 1 };
          }
          return l;
        });
      });
    }
  }

  return (
    <div className="space-y-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card className="space-y-3 p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Escanea cada caja al subirla</p>
            <p className="text-xs text-slate-500">Solo entran etiquetas de lo que viene en la factura.</p>
          </div>
          <p className={`text-right text-2xl font-bold ${faltan ? "text-amber-700" : "text-green-700"}`}>
            {total - faltan}/{total}
            <span className="block text-xs font-medium">{faltan ? `faltan ${faltan}` : "completo"}</span>
          </p>
        </div>
        <Escaner onCodigo={escanear} />
        {ultimo && (
          <div className={`rounded-lg px-4 py-3 text-center ${ultimo.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
            <p className="text-lg font-bold">{ultimo.ok ? `✓ ${ultimo.clave}` : "✗ NO SE CARGA"}</p>
            <p className="text-sm">{ultimo.ok ? `${ultimo.codigo} · ${ultimo.escaneadas} de ${ultimo.cantidad}` : ultimo.mensaje}</p>
            {ultimo.ok && ultimo.aviso && <p className="mt-1 rounded bg-white/20 px-2 py-1 text-xs">{ultimo.aviso}</p>}
          </div>
        )}
      </Card>

      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {lineas.map((l) => {
            const ok = l.escaneadas >= l.cantidad;
            return (
              <li key={l.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-500">{l.clave ?? "Sin clave"}</p>
                    <p className="text-sm text-slate-900">{l.descripcion}</p>
                  </div>
                  {l.articulo_id ? (
                    <span className={`shrink-0 text-lg font-bold ${ok ? "text-green-700" : "text-slate-800"}`}>{l.escaneadas}/{l.cantidad}</span>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-500">{l.cantidad} · no se escanea</span>
                  )}
                </div>
                {l.articulo_id && (
                  <div className="h-2 overflow-hidden rounded bg-slate-100">
                    <div className={`h-full ${ok ? "bg-green-600" : "bg-amber-500"}`} style={{ width: `${Math.min(100, (l.escaneadas / l.cantidad) * 100)}%` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {cargadas.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-800">Etiquetas cargadas ({cargadas.length}) · quitar si se escaneó por error</summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {cargadas.map((c) => (
              <li key={c.codigo} className="flex items-center justify-between py-1.5">
                <span><span className="font-mono">{c.codigo}</span> <span className="text-slate-500">{c.clave}</span></span>
                <button
                  type="button"
                  disabled={!!busy}
                  className="text-xs text-red-700 underline"
                  onClick={() =>
                    run(`q${c.codigo}`, () => quitarEscaneoAction(salidaId, c.codigo), () => {
                      setCargadas((x) => x.filter((y) => y.codigo !== c.codigo));
                      setLineas((ls) => {
                        let hecho = false;
                        return [...ls].reverse().map((l) => {
                          if (!hecho && l.clave === c.clave && l.escaneadas > 0) {
                            hecho = true;
                            return { ...l, escaneadas: l.escaneadas - 1 };
                          }
                          return l;
                        }).reverse();
                      });
                    })
                  }
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!cerrar ? (
        <div className="flex flex-wrap gap-2">
          <Button className={faltan ? "" : "bg-green-600 hover:bg-green-700"} onClick={() => (faltan ? setCerrar("terminar") : run("t", () => terminarSalidaAction(salidaId, ""), () => router.refresh()))} loading={busy === "t"}>
            {faltan ? "Terminar con faltantes" : "Terminar carga"}
          </Button>
          <Button variant="ghost" className="text-red-700" onClick={() => setCerrar("cancelar")}>Cancelar entrega</Button>
        </div>
      ) : (
        <Card className="space-y-2 p-4">
          <p className="text-sm font-medium text-slate-800">{cerrar === "terminar" ? `Faltan ${faltan} pieza(s). ¿Por qué se cierra incompleta?` : "¿Por qué se cancela? Las etiquetas escaneadas regresan al almacén."}</p>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={cerrar === "terminar" ? "Ej. No hay existencia de talla M, se manda después" : "Ej. El cliente canceló el pedido"} />
          <div className="flex gap-2">
            <Button
              loading={busy === "c"}
              disabled={nota.trim().length < 3}
              className={cerrar === "cancelar" ? "bg-red-600 hover:bg-red-700" : ""}
              onClick={() => run("c", () => (cerrar === "terminar" ? terminarSalidaAction(salidaId, nota) : cancelarSalidaAction(salidaId, nota)), () => router.refresh())}
            >
              {cerrar === "terminar" ? "Cerrar incompleta" : "Cancelar entrega"}
            </Button>
            <Button variant="ghost" onClick={() => setCerrar(null)}>Regresar</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** El vendedor puede cancelar mientras almacen no empieza a cargar. */
export function CancelarEntrega({ salidaId }: { salidaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { run, busy, notice, router } = useRun();
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {!abierto ? (
        <Button variant="ghost" className="text-sm text-red-700" onClick={() => setAbierto(true)}>Cancelar esta entrega</Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" />
          <Button className="bg-red-600 hover:bg-red-700" loading={busy === "c"} disabled={motivo.trim().length < 3} onClick={() => run("c", () => cancelarSalidaAction(salidaId, motivo), () => router.refresh())}>Cancelar</Button>
        </div>
      )}
    </div>
  );
}
