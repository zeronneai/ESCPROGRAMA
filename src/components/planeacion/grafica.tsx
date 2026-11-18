import { addDias, DIAS_MES, fmtNum, llegadaEfectiva, mesCorto, type ArticuloPlan, type Calculo, type Parametros, type PlanProveedor } from "@/lib/planeacion";

/** Venta por mes (barras), meses con dias sin existencia (rojo), existencia al cierre y proyeccion de 12 meses. */
export function GraficaArticulo({ a, c, prov, p, hoy, pedir }: { a: ArticuloPlan; c: Calculo; prov: PlanProveedor; p: Parametros; hoy: string; pedir: number }) {
  const ms = a.historial;
  if (!ms.length) return <p className="text-sm text-slate-500">Sin historial de Microsip para este artículo.</p>;
  const W = 760, H = 260, L = 48, R = 12, T = 14, B = 30, nF = 12;
  const n = ms.length + nF;
  const bw = (W - L - R) / n;
  const vals = ms.map((m) => m.venta + (p.traspasos ? m.traspasos : 0));
  const llega = addDias(hoy, prov.entrega_dias);
  const lls = a.llegadas.map((l) => ({ f: llegadaEfectiva(l.fecha, hoy), u: l.cantidad }));
  const proj: number[] = [];
  let s = a.existencia;
  for (let k = 0; k < nF; k++) {
    const ini = addDias(hoy, k * DIAS_MES), fin = addDias(hoy, (k + 1) * DIAS_MES);
    for (const l of lls) if (l.f >= ini && l.f < fin) s += l.u;
    if (pedir && llega >= ini && llega < fin) s += pedir;
    s -= c.plan;
    proj.push(Math.max(0, s));
  }
  const maxY = Math.max(10, ...vals, ...ms.map((m) => m.existencia_fin ?? 0), ...proj, c.reorden) * 1.08;
  const y = (v: number) => T + (H - T - B) * (1 - v / maxY);
  const x = (i: number) => L + i * bw;
  const x0 = x(ms.length);
  const ticks = [0, 1, 2, 3, 4].map((i) => (maxY / 4) * i);
  const ultimo = ms[ms.length - 1];
  const puntos = ms.map((m, i) => `${x(i) + bw / 2},${y(m.existencia_fin ?? a.existencia)}`).join(" ");
  const puntosF = [`${x(ms.length - 1) + bw / 2},${y(ultimo.existencia_fin ?? a.existencia)}`, ...proj.map((v, k) => `${x(ms.length + k) + bw / 2},${y(v)}`)].join(" ");
  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[620px]" role="img" aria-label={`Venta y existencia de ${a.clave}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#64748b">{fmtNum(v)}</text>
            </g>
          ))}
          {ms.map((m, i) => {
            const sin = m.dias ? 1 - m.dias_stock / m.dias : 0;
            return (
              <g key={m.mes}>
                {sin > 0.02 && <rect x={x(i)} y={T} width={bw} height={H - T - B} fill="#dc2626" opacity={Math.min(0.35, 0.08 + sin * 0.3)}><title>{`${m.mes}: ${fmtNum(sin * 100)}% de días sin existencia`}</title></rect>}
                <rect x={x(i) + bw * 0.15} y={y(vals[i])} width={bw * 0.7} height={Math.max(0, y(0) - y(vals[i]))} rx="2" fill="#3468e0"><title>{`${m.mes}: vendió ${fmtNum(vals[i])}`}</title></rect>
                {(i % 2 === 0 || ms.length < 14) && (
                  <text x={x(i) + bw / 2} y={H - B + 14} textAnchor="middle" fontSize="10" fill="#64748b">{mesCorto(m.mes)}{m.mes.endsWith("-01") || i === 0 ? ` ${m.mes.slice(2, 4)}` : ""}</text>
                )}
              </g>
            );
          })}
          <rect x={x0} y={T} width={W - R - x0} height={H - T - B} fill="#dce8ff" opacity="0.45" />
          <text x={x0 + 6} y={T + 12} fontSize="10" fill="#64748b">Proyección</text>
          {proj.map((_, k) => k % 2 === 0 && <text key={k} x={x(ms.length + k) + bw / 2} y={H - B + 14} textAnchor="middle" fontSize="10" fill="#64748b">{mesCorto(addDias(hoy, (k + 0.5) * DIAS_MES))}</text>)}
          <polyline points={puntos} fill="none" stroke="#e8730c" strokeWidth="2" />
          <polyline points={puntosF} fill="none" stroke="#e8730c" strokeWidth="2" strokeDasharray="5 4" />
          <line x1={L} x2={W - R} y1={y(c.real)} y2={y(c.real)} stroke="#0f172a" strokeWidth="1.2" strokeDasharray="2 3" />
          <text x={W - R - 4} y={y(c.real) - 4} textAnchor="end" fontSize="10" fill="#0f172a">venta real {fmtNum(c.real)}/mes</text>
          {c.reorden > 0 && (
            <>
              <line x1={x0} x2={W - R} y1={y(c.reorden)} y2={y(c.reorden)} stroke="#b42318" strokeWidth="1.2" />
              <text x={x0 + 6} y={y(c.reorden) - 4} fontSize="10" fill="#b42318">punto de pedido</text>
            </>
          )}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
        <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-brand-500 align-[-2px]" />Venta del mes</span>
        <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-red-200 align-[-2px]" />Días sin existencia</span>
        <span><i className="mr-1 inline-block h-3 w-3 rounded-sm bg-[#e8730c] align-[-2px]" />Existencia (punteada: proyección con lo que viene{pedir ? " y lo que vas a pedir" : ""})</span>
      </div>
    </div>
  );
}
