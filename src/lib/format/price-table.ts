import Decimal from "decimal.js";

/**
 * Formato de la tabla de precios que el vendedor copia para el cliente.
 * Es el UNICO lugar con el formato: cuando ESC defina su formato oficial,
 * basta con reemplazar esta funcion.
 *
 * Privacidad: la entrada NUNCA incluye costo, envio, base, proveedor ni
 * porcentajes. Solo los 5 precios finales y las condiciones.
 */

export interface PriceTableItem {
  folio: string;
  /** Nombre para el cliente (el mismo que el PDF). Nunca la descripcion ni el uso, que son internos. */
  producto: string;
  cantidad?: number | string | null;
  unidad?: string | null;
  talla?: string | null;
  moneda: "MXN" | "USD";
  /** Texto ya formateado, ej. "5 dias habiles". */
  entrega: string;
  /** Texto ya formateado, ej. "10 piezas". Opcional. */
  compraMinima?: string | null;
  /** Precios unitarios 1 a 5. */
  precios: [string, string, string, string, string];
  /** 1 a 5. Si se indica y onlySelected es true, solo se muestra ese. */
  precioElegido?: 1 | 2 | 3 | 4 | 5 | null;
}

/** Todos los precios del portal son SIN IVA; la nota va visible en el texto copiado. */
export const NOTA_SIN_IVA = "Precios sin IVA";

export interface FormattedPriceTable {
  html: string;
  text: string;
}

export interface FormatOptions {
  onlySelected?: boolean;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function money(value: string, currency: string): string {
  const d = new Decimal(value);
  const [int, dec] = d.toFixed(2).split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${dec} ${currency}`;
}

function cantidadTexto(i: PriceTableItem): string {
  const parts: string[] = [];
  if (i.cantidad !== null && i.cantidad !== undefined && i.cantidad !== "") {
    parts.push(`${i.cantidad}${i.unidad ? ` ${i.unidad}` : ""}`);
  }
  if (i.talla) parts.push(`Talla ${i.talla}`);
  return parts.join(" / ");
}

interface Row {
  label: string;
  unit: string;
  total: string | null;
}

function rows(i: PriceTableItem, opts: FormatOptions): Row[] {
  const qty =
    i.cantidad !== null && i.cantidad !== undefined && i.cantidad !== ""
      ? new Decimal(i.cantidad)
      : null;
  const all: Row[] = i.precios.map((p, idx) => ({
    label: `Precio ${idx + 1}`,
    unit: money(p, i.moneda),
    total: qty
      ? money(
          new Decimal(p).times(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
          i.moneda,
        )
      : null,
  }));
  if (opts.onlySelected && i.precioElegido) {
    return [all[i.precioElegido - 1]];
  }
  return all;
}

function itemText(i: PriceTableItem, opts: FormatOptions): string {
  const lines: string[] = [];
  lines.push(`${i.folio} - ${i.producto}`);
  const c = cantidadTexto(i);
  if (c) lines.push(`Cantidad: ${c}`);
  lines.push(`Moneda: ${i.moneda}`);
  lines.push(`Tiempo de entrega: ${i.entrega}`);
  if (i.compraMinima) lines.push(`Compra minima: ${i.compraMinima}`);
  for (const r of rows(i, opts)) {
    lines.push(
      `${r.label}: ${r.unit} c/u${r.total ? ` (total ${r.total})` : ""}`,
    );
  }
  return lines.join("\n");
}

function itemHtml(i: PriceTableItem, opts: FormatOptions): string {
  const rs = rows(i, opts);
  const showTotal = rs.some((r) => r.total);
  const cell = "border:1px solid #999;padding:4px 8px;";
  const head = `${cell}background:#eee;text-align:left;`;
  const info = [
    ...(cantidadTexto(i) ? [["Cantidad", cantidadTexto(i)]] : []),
    ["Moneda", i.moneda],
    ["Tiempo de entrega", i.entrega],
    ...(i.compraMinima ? [["Compra minima", i.compraMinima]] : []),
  ];
  const infoRows = info
    .map(
      ([k, v]) =>
        `<tr><td style="${head}">${esc(k)}</td><td style="${cell}" colspan="${showTotal ? 2 : 1}">${esc(v)}</td></tr>`,
    )
    .join("");
  const priceRows = rs
    .map(
      (r) =>
        `<tr><td style="${cell}">${esc(r.label)}</td><td style="${cell}text-align:right;">${esc(r.unit)}</td>${
          showTotal ? `<td style="${cell}text-align:right;">${esc(r.total ?? "")}</td>` : ""
        }</tr>`,
    )
    .join("");
  return (
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-bottom:12px;">` +
    `<tr><th style="${head}" colspan="${showTotal ? 3 : 2}">${esc(i.folio)} - ${esc(i.producto)}</th></tr>` +
    infoRows +
    `<tr><th style="${head}">Precio</th><th style="${head}">Unitario</th>${
      showTotal ? `<th style="${head}">Total</th>` : ""
    }</tr>` +
    priceRows +
    `</table>`
  );
}

export function formatPriceTable(
  items: PriceTableItem[],
  opts: FormatOptions = {},
): FormattedPriceTable {
  if (items.length === 0) return { text: "", html: "" };
  return {
    text: `${items.map((i) => itemText(i, opts)).join("\n\n")}\n\n${NOTA_SIN_IVA}`,
    html: `${items.map((i) => itemHtml(i, opts)).join("\n")}\n<p style="font-family:Arial,sans-serif;font-size:12px;color:#444;margin:0 0 12px;">${NOTA_SIN_IVA}</p>`,
  };
}
