import type { QuoteRow } from "./types";

/** Folio de una version: la v1 usa el folio base; las siguientes agregan -R2, -R3... */
export function revisionFolio(folio: string, version: number): string {
  return version > 1 ? `${folio}-R${version}` : folio;
}

/** Revision de la solicitud: la version mas alta entre sus partidas (minimo 1). */
export function requestRevision(items: Array<{ item_quotes?: Pick<QuoteRow, "version">[] }>): number {
  let max = 1;
  for (const i of items) for (const q of i.item_quotes ?? []) if (q.version > max) max = q.version;
  return max;
}

/** La vigencia ya vencio (se calcula al consultar, no con cron). */
export function isVigenciaVencida(q: Pick<QuoteRow, "valid_until"> | null | undefined, now: Date): boolean {
  return !!q?.valid_until && new Date(q.valid_until).getTime() < now.getTime();
}

/** Dias naturales que le quedan a la vigencia (negativo si ya vencio). */
export function vigenciaDiasRestantes(q: Pick<QuoteRow, "valid_until">, now: Date): number | null {
  if (!q.valid_until) return null;
  return Math.ceil((new Date(q.valid_until).getTime() - now.getTime()) / 86_400_000);
}

/**
 * Numero de una cotizacion emitida al cliente: folio, -R{revision} si el comprador actualizo costos y
 * -V{secuencia} por cada recotizacion de la misma revision. Debe coincidir con issue_quote() en la BD.
 */
export function issueNumber(folio: string, revision: number, secuencia: number): string {
  return `${revisionFolio(folio, revision)}${secuencia > 1 ? `-V${secuencia}` : ""}`;
}
