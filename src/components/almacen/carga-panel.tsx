"use client";

import { useState } from "react";
import { cancelarSalidaAction, escanearAction, esperaSalidaAction, quitarEscaneoAction, terminarSalidaAction, type Escaneo } from "@/actions/almacen";
import { Escaner, beep } from "@/components/almacen/escaner";
import { useRun } from "@/components/ops-ui";
import { Alert, Button, Card, Input } from "@/components/ui";
import type { SalidaLinea } from "@/lib/almacen";

type Cargada = { codigo: string; clave: string };

/** Carga del camion: escanear cada etiqueta contra la factura. */
export function CargaPanel({ salidaId, lineas: ini, cargadas: iniCargadas, espera }: { salidaId: string; lineas: SalidaLinea[]; cargadas: Cargada[]; espera: { nota: string | null; nombre: string | null; fecha: string | null } | null }) {
  const [lineas, setLineas] = useState(ini);
  const [cargadas, setCargadas] = useState<Cargada[]>(iniCargadas);
  const [ultimo, setUltimo] = useState<Escaneo | null>(null);
  const [enEspera, setEnEspera] = useState(false);
  const [nota, setNota] = useState("No es posible surtir por falta de material: ");
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

      {espera && (
        <Alert tone="info">
          <span className="font-semibold">En espera por falta de material.</span> {espera.nota}
          <span className="block text-xs">{[espera.nombre, espera.fecha].filter(Boolean).join(" · ")}. Cuando llegue el material sigue escaneando; al completar se termina.</span>
        </Alert>
      )}
      {!enEspera ? (
        <div className="flex flex-wrap gap-2">
          <Button
            className={faltan ? "" : "bg-green-600 hover:bg-green-700"}
            disabled={faltan > 0}
            title={faltan ? "Solo se termina cuando están todas las piezas" : undefined}
            onClick={() => run("t", () => terminarSalidaAction(salidaId, ""), () => router.refresh())}
            loading={busy === "t"}
          >
            {faltan ? `Terminar carga (faltan ${faltan})` : "Terminar carga"}
          </Button>
          {faltan > 0 && !espera && <Button variant="secondary" onClick={() => setEnEspera(true)}>No hay material: poner en espera</Button>}
          {espera && <Button variant="ghost" loading={busy === "r"} onClick={() => run("r", () => esperaSalidaAction(salidaId, false, ""), () => router.refresh())}>Ya hay material: quitar espera</Button>}
        </div>
      ) : (
        <Card className="space-y-2 p-4">
          <p className="text-sm font-medium text-slate-800">Mensaje para el vendedor y compras (la factura no se cancela, queda en espera):</p>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. No es posible surtir por falta de material: talla M" />
          <div className="flex gap-2">
            <Button
              loading={busy === "e"}
              disabled={nota.trim().length < 5}
              onClick={() => run("e", () => esperaSalidaAction(salidaId, true, nota), () => { setEnEspera(false); router.refresh(); })}
            >
              Poner en espera y avisar
            </Button>
            <Button variant="ghost" onClick={() => setEnEspera(false)}>Regresar</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Quien subio la factura la puede cancelar mientras almacen no empieza a cargar (la jefa de ventas, siempre que este abierta). */
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
