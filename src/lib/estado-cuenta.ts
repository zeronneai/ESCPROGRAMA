/**
 * Lector de estados de cuenta (conciliacion bancaria). Recibe los renglones del PDF con la posicion
 * de cada texto (pdf.js) y regresa SOLO los abonos: fecha, descripcion, referencia y monto.
 * Los cargos se ignoran. Funciona con BBVA (BBVANet "Detalle de movimientos") y Banregio
 * ("Detalle de Movimientos Cuenta de Cheques"); el formato es el mismo entre cuentas.
 * Para saber si un monto es cargo o abono se ve en que columna cae (debajo de "Cargo" o "Abono").
 */
export type Celda = { x: number; s: string };
export type Pagina = Celda[][]; // renglones de arriba hacia abajo, cada uno ordenado por x

export interface MovimientoLeido {
  fecha: string; // YYYY-MM-DD
  descripcion: string;
  referencia: string | null;
  monto: number;
  saldo: number | null;
}
export interface EstadoCuentaLeido {
  banco: "BBVA" | "Banregio" | "Otro";
  cuenta: string | null;
  moneda: "MXN" | "USD";
  desde: string | null;
  hasta: string | null;
  abonos: MovimientoLeido[];
  cargosIgnorados: number;
  totalAbonos: number;
  /** Revision con los saldos: cuantos movimientos cuadran (saldo anterior +/- monto = saldo). */
  cuadran: number;
  noCuadran: number;
}

/** Cuentas en dolares (terminacion del numero de cuenta). */
export const CUENTAS_USD = ["157"];

const DINERO = /^\$?\s*-?[\d,]+\.\d{2}$/;
const num = (s: string) => Number(s.replace(/[$,\s]/g, ""));
const RUIDO = /BBVANet|https?:\/\/|Total (Cargos|Abonos)|Saldo (Final|Inicial|disponible)|N[uú]mero de cuenta|P[aá]gina \d|^\d{2}\/\d{2}\/\d{2},/i;

function fechaIso(s: string, anioRef: number, mesRef: number): string | null {
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})-(\d{2})$/); // BBVA: "24-11" sin año
  if (m) {
    const mes = Number(m[2]);
    const anio = mes > mesRef ? anioRef - 1 : anioRef;
    return `${anio}-${m[2]}-${m[1]}`;
  }
  return null;
}

export function leerEstadoCuenta(paginas: Pagina[]): EstadoCuentaLeido {
  const todo = paginas.flat().map((r) => r.map((c) => c.s).join(" ")).join("\n");
  // Por el encabezado (las descripciones pueden decir "BBVA MEXICO" en un estado de Banregio).
  const banco: EstadoCuentaLeido["banco"] = /BBVANet|Cuenta con \/ sin chequera/i.test(todo) ? "BBVA" : /CLABE:\s*058|BANREGIO|Detalle de Movimientos Cuenta de Cheques/i.test(todo) ? "Banregio" : /BBVA/i.test(todo) ? "BBVA" : "Otro";
  const cuenta = todo.match(/N[uú]mero de cuenta:\s*(\d{6,20})/i)?.[1] ?? todo.match(/\bCUENTA:\s*(\d{6,20})/i)?.[1] ?? null;
  // Fecha de referencia para las fechas sin año (BBVA): la del encabezado.
  const ref = todo.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  const anioRef = ref ? Number(ref[3]) : new Date().getFullYear();
  const mesRef = ref ? Number(ref[2]) : new Date().getMonth() + 1;

  type Mov = { y: number; pag: number; fecha: string; monto: number; esAbono: boolean; saldo: number | null; desc: string[]; ref: string | null };
  const movs: Mov[] = [];
  let cols: { cargo: number; abono: number; saldo: number; desc: number; refX: number | null; abajo: boolean } | null = null;
  let cargos = 0;

  paginas.forEach((filas, pag) => {
    const enPagina: Mov[] = [];
    const textos: { y: number; s: string; x: number }[] = [];
    let y = 0;
    for (const r of filas) {
      y += 1; // indice de renglon (de arriba hacia abajo)
      const txt = r.map((c) => c.s).join(" ");
      const iC = r.findIndex((c) => /^Cargos?$/i.test(c.s));
      const iA = r.findIndex((c) => /^Abonos?$/i.test(c.s));
      const iS = r.findIndex((c) => /^Saldo$/i.test(c.s));
      if (iC >= 0 && iA >= 0 && r.some((c) => /^Fecha$/i.test(c.s))) {
        const d = r.find((c) => /Descripci|Concepto/i.test(c.s));
        const rf = r.find((c) => /^Referencia$/i.test(c.s));
        // Banregio: la descripcion sigue DEBAJO de la fecha; BBVA: arriba y abajo.
        cols = { cargo: r[iC].x, abono: r[iA].x, saldo: iS >= 0 ? r[iS].x : r[iA].x + 80, desc: d?.x ?? 0, refX: rf?.x ?? null, abajo: !!rf };
        continue;
      }
      if (!cols || RUIDO.test(txt)) continue;
      const f = r[0] && cols ? fechaIso(r[0].s, anioRef, mesRef) : null;
      const montos = r.filter((c) => DINERO.test(c.s.replace(/\s+/g, " ")));
      if (f && montos.length >= 1) {
        const c = cols;
        const saldoCel = montos.length >= 2 ? montos[montos.length - 1] : null;
        const mov = montos.length >= 2 ? montos[montos.length - 2] : montos[0];
        const corte = (c.cargo + c.abono) / 2;
        const esAbono = mov.x >= corte && mov.x < (c.abono + c.saldo) / 2 + 10;
        const desc = r.filter((x) => x !== r[0] && !montos.includes(x) && x.x < c.cargo - 5 && (c.refX == null || x.x < c.refX - 5)).map((x) => x.s);
        const refCel = c.refX != null ? r.find((x) => Math.abs(x.x - c.refX!) < 15 && !montos.includes(x)) : undefined;
        const m: Mov = { y, pag, fecha: f, monto: num(mov.s), esAbono, saldo: saldoCel ? num(saldoCel.s) : null, desc, ref: refCel?.s.replace(/^_/, "") ?? null };
        movs.push(m);
        enPagina.push(m);
        continue;
      }
      // Renglon de descripcion: texto entre la columna de fecha y la de cargos.
      const partes = r.filter((x) => x.x > (cols!.desc || 0) - 60 && x.x < cols!.cargo - 5 && (cols!.refX == null || x.x < cols!.refX - 5));
      if (partes.length) textos.push({ y, s: partes.map((x) => x.s).join(" "), x: partes[0].x });
    }
    // Repartir los renglones de descripcion entre los movimientos de la pagina:
    // un renglon justo ARRIBA de un movimiento que no trae descripcion en su propio renglon es su
    // primer renglon (asi vienen BBVA y Banregio); los demas son continuacion del movimiento anterior.
    const propia = new Set(enPagina.filter((m) => m.desc.length > 0));
    for (const t of textos) {
      const abajo = enPagina.find((m) => m.y === t.y + 1);
      let dueno: Mov | undefined = abajo && !propia.has(abajo) ? abajo : undefined;
      if (!dueno) dueno = [...enPagina].reverse().find((m) => m.y < t.y);
      if (!dueno) dueno = enPagina.find((m) => m.y > t.y);
      if (dueno) (t.y < dueno.y ? dueno.desc.unshift(t.s) : dueno.desc.push(t.s));
    }
  });

  const abonos = movs
    .filter((m) => {
      if (!m.esAbono) cargos += 1;
      return m.esAbono;
    })
    .map((m) => ({ fecha: m.fecha, descripcion: m.desc.join(" ").replace(/\s+/g, " ").trim(), referencia: m.ref, monto: m.monto, saldo: m.saldo }));
  // Revision: con los saldos se ve si cada monto se leyo en la columna correcta.
  const sig = (m: Mov) => (m.esAbono ? m.monto : -m.monto);
  const ok = (a: number, b: number) => Math.abs(a - b) < 0.02;
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < movs.length; i++) {
    const p = movs[i - 1];
    const m = movs[i];
    if (p.saldo == null || m.saldo == null) continue;
    if (ok(p.saldo + sig(m), m.saldo)) asc++;
    if (ok(m.saldo + sig(p), p.saldo)) desc++;
  }
  const cuadran = Math.max(asc, desc);
  const parejas = movs.filter((m, i) => i > 0 && m.saldo != null && movs[i - 1].saldo != null).length;
  const fechas = movs.map((m) => m.fecha).sort();
  return {
    banco,
    cuenta,
    moneda: cuenta && CUENTAS_USD.some((t) => cuenta.endsWith(t)) ? "USD" : "MXN",
    desde: fechas[0] ?? null,
    hasta: fechas[fechas.length - 1] ?? null,
    abonos,
    cargosIgnorados: cargos,
    totalAbonos: Math.round(abonos.reduce((a, m) => a + m.monto, 0) * 100) / 100,
    cuadran,
    noCuadran: parejas - cuadran,
  };
}
