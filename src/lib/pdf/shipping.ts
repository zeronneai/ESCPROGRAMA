import { parseNumber } from "@/lib/validation/request";

export type ShippingCurrency = "MXN" | "USD";

export type ShippingParse =
  | { ok: true; monto: number | null; moneda: ShippingCurrency | null }
  | { ok: false; error: string };

/**
 * Costo de envio AL CLIENTE (flete de ESC al destino). Campo opcional por solicitud.
 * - Vacio o 0: sin cargo (el PDF usa la leyenda de "incluido" si hay destino).
 * - Mayor a 0: necesita moneda; por defecto la de las partidas si es una sola, y si la solicitud
 *   mezcla pesos y dolares el vendedor debe elegirla.
 * No confundir con el costo de envio del proveedor, que captura el comprador y el vendedor nunca ve.
 */
export function parseShippingInput(
  input: { monto?: string | null; moneda?: string | null },
  itemCurrencies: ShippingCurrency[],
): ShippingParse {
  const n = parseNumber(input.monto ?? "");
  if (n === undefined || n === 0) return { ok: true, monto: null, moneda: null };
  if (Number.isNaN(n) || n < 0) return { ok: false, error: "El costo de envío al cliente no es válido" };
  const chosen = input.moneda === "MXN" || input.moneda === "USD" ? input.moneda : null;
  if (chosen) return { ok: true, monto: n, moneda: chosen };
  if (itemCurrencies.length === 1) return { ok: true, monto: n, moneda: itemCurrencies[0] };
  return { ok: false, error: "Elige la moneda del costo de envío al cliente (la solicitud mezcla pesos y dólares)" };
}
