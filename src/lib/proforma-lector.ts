/**
 * Lector de proformas (PI) y facturas de proveedores extranjeros (sobre todo de China).
 * Cada proveedor usa su propio formato (PDF, Excel o Word), asi que es "mejor esfuerzo":
 * busca etiquetas comunes en ingles (PI NO., INVOICE NO., DATE, TOTAL, DEPOSIT, BALANCE...)
 * y el comprador revisa antes de guardar.
 */
import type { Moneda } from "@/lib/pagos";

export interface DocProveedor {
  tipo: "proforma" | "factura";
  numero: string | null;
  oc: string | null;
  fecha: string | null;
  moneda: Moneda | null;
  total: number | null;
  depositoPct: number | null;
  deposito: number | null;
  saldoPct: number | null;
  saldo: number | null;
  condiciones: string | null;
  proveedorId: string | null;
  avisos: string[];
}

const MESES: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, oct: 10, nov: 11, dec: 12, dic: 12,
};

/** "43,237.42", "43.237,42", "USD43237.42" a numero. */
export function aNumero(s: string): number | null {
  let t = s.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const ultPunto = t.lastIndexOf(".");
  const ultComa = t.lastIndexOf(",");
  if (ultPunto >= 0 && ultComa >= 0) {
    t = ultComa > ultPunto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (ultComa >= 0) {
    // "1,234" (miles) o "12,50" (decimales)
    t = /,\d{3}$/.test(t) && !/,\d{3},\d{1,2}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null);

/** Fechas en los formatos que usan los proveedores. */
export function aFecha(s: string): string | null {
  let m = s.match(/\b(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/);
  if (m && MESES[m[1].toLowerCase().slice(0, 3)]) return iso(+m[3], MESES[m[1].toLowerCase().slice(0, 3)], +m[2]);
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s/.-]+([A-Za-z]{3,9})\.?[\s/,.-]+(20\d{2}|\d{2})\b/);
  if (m && MESES[m[2].toLowerCase().slice(0, 3)]) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], MESES[m[2].toLowerCase().slice(0, 3)], +m[1]);
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    // Si el segundo pasa de 12 es mes/dia (estilo EE.UU.); si no, dia/mes.
    return b > 12 ? iso(+m[3], a, b) : iso(+m[3], b, a);
  }
  return null;
}

const montos = (linea: string) => (linea.match(/(?:US\$|\$|USD|RMB|CNY|¥|EUR|€|MXN)?\s*\d[\d,.]*\d|\d/g) ?? []).map(aNumero).filter((n): n is number => n !== null);
const NO_DINERO = /\b(QTY|QUANTITY|CTNS?|CARTONS?|PCS|PIECES|ROLLS?|BOX(ES)?|KGS?|WEIGHT|CBM|VOLUME|PALLETS?|ITEMS?)\b/i;
const tieneMoneda = (l: string) => /US\$|\$|USD|RMB|CNY|¥|EUR|€|MXN/i.test(l);

function etiqueta(lineas: string[], re: RegExp): string | null {
  for (const l of lineas) {
    const m = l.match(re);
    if (m?.[1]) {
      const v = m[1].trim().replace(/[.,;:]+$/, "");
      if (v.length >= 3 && /\d/.test(v)) return v.toUpperCase();
    }
  }
  return null;
}

/** Lee el texto (renglones) de una proforma o factura de proveedor. */
export function leerDocProveedor(renglones: string[], proveedores: { id: string; nombre: string }[] = []): DocProveedor {
  const lineas = renglones.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const todo = lineas.join("\n");
  const T = todo.toUpperCase();
  const avisos: string[] = [];

  const esProforma = /PROFORMA|PRO-FORMA|P\s*\/\s*I\s*(NO|NUMBER|#)|\bPI\s*(NO|NUMBER|#)|形式发票/.test(T);
  const esFactura = /COMMERCIAL\s+INVOICE|商业发票|\bFINAL\s+INVOICE/.test(T);
  const tipo: DocProveedor["tipo"] = esProforma && !esFactura ? "proforma" : "factura";

  const SEP = String.raw`\s*(?:NO\.?|NUMBER|NUM\.?|#)\s*[.:：]?\s*`;
  const TOKEN = String.raw`([A-Z0-9][A-Z0-9\-/_.]{2,30})`;
  const numero =
    (tipo === "proforma"
      ? etiqueta(lineas, new RegExp(String.raw`(?:PROFORMA\s+INVOICE|P\s*/\s*I|\bPI)${SEP}${TOKEN}`, "i"))
      : etiqueta(lineas, new RegExp(String.raw`(?:COMMERCIAL\s+INVOICE|INVOICE|\bINV)${SEP}${TOKEN}`, "i"))) ??
    etiqueta(lineas, new RegExp(String.raw`(?:INVOICE|PROFORMA|\bPI|\bINV)${SEP}${TOKEN}`, "i"));
  const oc = etiqueta(lineas, new RegExp(String.raw`(?:P\.?\s*O\.?|PURCHASE\s+ORDER|ORDER|CONTRACT|S\s*/\s*C)${SEP}${TOKEN}`, "i"));

  let fecha: string | null = null;
  for (const l of lineas) {
    const m = l.match(/\b(?:DATE|DATED|FECHA|日期)\s*[.:：]?\s*(.{6,30})/i);
    if (m) {
      fecha = aFecha(m[1]);
      if (fecha) break;
    }
  }
  if (!fecha) fecha = aFecha(todo);

  const cuenta = (re: RegExp) => (T.match(re) ?? []).length;
  const votos: [Moneda, number][] = [
    // "$" solo, sin otra moneda, en proformas de China casi siempre es dolar.
    ["USD", cuenta(/USD|US\$|U\.?S\.? DOLLARS?|(?<![A-Z])\$/g)],
    ["CNY", cuenta(/RMB|CNY|¥|人民币/g)],
    ["EUR", cuenta(/EUR|€/g)],
    ["MXN", cuenta(/MXN|PESOS/g)],
  ];
  votos.sort((a, b) => b[1] - a[1]);
  const moneda = votos[0][1] > 0 ? votos[0][0] : null;

  // Total: el monto mas grande en renglones que dicen TOTAL (sin contar cantidades, pesos o volumen).
  let total: number | null = null;
  const conSigno = (l: string) => (l.match(/(?:US\$|\$|USD|RMB|CNY|¥|EUR|€)\s*\d[\d,.]*\d/gi) ?? []).map(aNumero).filter((n): n is number => n !== null);
  lineas.forEach((l, i) => {
    if (!/TOTAL|AMOUNT\s+DUE|SUMA|合计|总计/i.test(l) || /SUB\s*-?\s*TOTAL|IN\s+WORDS|IN\s+WRITING|\bSAY\b/i.test(l)) return;
    let ns = conSigno(l);
    if (!ns.length && !(NO_DINERO.test(l) && !tieneMoneda(l))) ns = montos(l).filter((n) => !Number.isInteger(n) || n >= 100);
    // La etiqueta "Total Amount :" a veces queda en su propio renglon y la cantidad en el de junto.
    if (!ns.length) ns = [...conSigno(lineas[i - 1] ?? ""), ...conSigno(lineas[i + 1] ?? "")];
    for (const n of ns) if (n > 0 && (total === null || n > total)) total = n;
  });

  // Condiciones de pago: deposito / anticipo y saldo.
  const pct = (re: RegExp) => {
    const m = T.match(re);
    const n = m ? Number(m[1] ?? m[2]) : NaN;
    return n > 0 && n < 100 ? n : null;
  };
  const depositoPct =
    pct(/(\d{1,2})\s*%\s*(?:T\s*\/\s*T\s*)?(?:IN\s+)?(?:DEPOSIT|ADVANCE|PREPAYMENT|DOWN\s*PAYMENT|ANTICIPO)/) ??
    pct(/(?:DEPOSIT|ADVANCE|PREPAYMENT|DOWN\s*PAYMENT|ANTICIPO)[^%\n]{0,40}?(\d{1,2})\s*%/);
  const todoAdelantado = /100\s*%[^\n]{0,40}(?:IN\s+ADVANCE|ADVANCE|PREPAY|BEFORE\s+(?:PRODUCTION|SHIPMENT))/.test(T);
  const saldoPct =
    pct(/(\d{1,2})\s*%\s*(?:T\s*\/\s*T\s*)?(?:THE\s+)?(?:BALANCE|SALDO|REST)/) ?? pct(/(?:BALANCE|SALDO)[^%\n]{0,40}?(\d{1,2})\s*%/);
  const montoDe = (re: RegExp) => {
    for (const l of lineas) {
      if (!re.test(l) || /%\s*$/.test(l)) continue;
      const sin = l.replace(/\d{1,3}\s*%/g, "");
      const ns = tieneMoneda(sin) ? conSigno(sin).concat(montos(sin).filter((n) => !Number.isInteger(n))) : montos(sin).filter((n) => !Number.isInteger(n) && n >= 1);
      if (ns.length) return Math.max(...ns);
    }
    return null;
  };
  let deposito = montoDe(/DEPOSIT|ADVANCE|PREPAYMENT|DOWN\s*PAYMENT|ANTICIPO/i);
  let saldo = montoDe(/BALANCE|SALDO/i);
  if (total && deposito && deposito >= total) deposito = null;
  if (total && saldo && saldo >= total) saldo = null;
  if (!deposito && depositoPct && total) deposito = Math.round(total * depositoPct) / 100;
  const pctFinal = depositoPct ?? (todoAdelantado ? 100 : null);
  if (todoAdelantado && !depositoPct && total) deposito = total;
  if (!saldo && saldoPct && total) saldo = Math.round(total * saldoPct) / 100;
  const condiciones = lineas.find((l) => /PAYMENT\s*(TERMS?|:)|TERMS\s+OF\s+PAYMENT|T\s*\/\s*T|CONDICIONES/i.test(l) && l.length < 200) ?? null;

  // Proveedor: el que aparezca por nombre en el documento.
  const norm = (s: string) => s.toUpperCase().normalize("NFD").replace(/[^A-Z0-9 ]/g, " ");
  const N = norm(todo);
  let proveedorId: string | null = null;
  let mejor = 0;
  for (const p of proveedores) {
    const pal = norm(p.nombre).split(/\s+/).filter((w) => w.length >= 4 && !/^(CO|LTD|LIMITED|COMPANY|INDUSTRY|INDUSTRIAL|TRADING|GROUP|INTERNATIONAL|TECHNOLOGY|MANUFACTURING|PRODUCTS)$/.test(w));
    const hits = pal.filter((w) => new RegExp(`\\b${w}\\b`).test(N)).length;
    if (hits > mejor) {
      mejor = hits;
      proveedorId = p.id;
    }
  }

  if (!numero) avisos.push(`No encontré el número de ${tipo === "proforma" ? "proforma" : "factura"}.`);
  if (!total) avisos.push("No encontré el total.");
  if (!fecha) avisos.push("No encontré la fecha.");
  return { tipo, numero, oc, fecha, moneda, total, depositoPct: pctFinal, deposito, saldoPct, saldo, condiciones, proveedorId, avisos };
}

const dinero = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** El anticipo o la factura que se registra con lo que se leyo del documento. */
export function pagoDesdeDoc(d: DocProveedor): { tipo: "anticipo" | "factura"; numero_factura: string; fecha_factura: string; monto: string; fecha_limite: string; notas: string } {
  if (d.tipo === "proforma") {
    const monto = d.deposito ?? d.total;
    const notas = [
      d.depositoPct === 100 ? "Pago 100% por adelantado" : d.depositoPct ? `Anticipo ${d.depositoPct}% de la proforma` : "Pago de la proforma",
      d.total ? `total ${dinero(d.total)}` : null,
      d.saldo ? `saldo ${d.saldoPct ? `${d.saldoPct}% ` : ""}${dinero(d.saldo)} pendiente` : null,
    ].filter(Boolean).join(", ");
    return { tipo: "anticipo", numero_factura: d.numero ?? "", fecha_factura: d.fecha ?? "", monto: monto ? String(monto) : "", fecha_limite: "", notas: notas.slice(0, 300) };
  }
  const monto = d.saldo ?? d.total;
  const notas = d.saldo && d.total ? `Saldo de la factura (total ${dinero(d.total)}${d.deposito ? `, anticipo ${dinero(d.deposito)}` : ""})` : "";
  return { tipo: "factura", numero_factura: d.numero ?? "", fecha_factura: d.fecha ?? "", monto: monto ? String(monto) : "", fecha_limite: "", notas: notas.slice(0, 300) };
}

/** Resumen corto de lo que se detecto, para mostrarlo al comprador. */
export function resumenDoc(d: DocProveedor, proveedor?: string | null): string {
  return [
    d.tipo === "proforma" ? "Proforma" : "Factura",
    d.numero,
    proveedor,
    d.fecha,
    d.total ? `total ${d.moneda ?? ""} ${dinero(d.total)}`.replace("  ", " ") : null,
    d.depositoPct ? `anticipo ${d.depositoPct}%` : null,
    d.saldoPct ? `saldo ${d.saldoPct}%` : null,
    d.oc ? `OC ${d.oc}` : null,
  ].filter(Boolean).join(" · ");
}
