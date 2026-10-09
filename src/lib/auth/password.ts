import { z } from "zod";

/** Minimo: 8 caracteres, con letras y numeros. */
export const passwordSchema = z
  .string()
  .min(8, "Minimo 8 caracteres")
  .regex(/[A-Za-z]/, "Debe incluir letras")
  .regex(/[0-9]/, "Debe incluir numeros");

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";

/** Entero uniforme en [0, max) con CSPRNG (rechazo para evitar sesgo). */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

/** Contrasena temporal segura (sirve en servidor y navegador), sin caracteres ambiguos. */
export function generateTempPassword(length = 14): string {
  const all = LETTERS + DIGITS + SYMBOLS;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(LETTERS), pick(LETTERS), pick(DIGITS), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
