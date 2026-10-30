import { z } from "zod";

/** RFC mexicano: 3 o 4 letras, fecha (6 digitos) y homoclave (3). Extranjero generico: XEXX010101000. */
export const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
export const RFC_EXTRANJERO = "XEXX010101000";
export const normalizeRfc = (v: string) => v.toUpperCase().replace(/[\s.-]/g, "");

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : null));

/** Alta y edicion de clientes (misma regla que la base de datos). */
export const customerSchema = z
  .object({
    nombre: z.string().trim().min(2, "Escribe el nombre del cliente").max(200),
    razon_social: opt(250),
    rfc: z
      .string()
      .transform(normalizeRfc)
      .refine((v) => RFC_RE.test(v), `RFC inválido (12 o 13 caracteres; extranjero: ${RFC_EXTRANJERO})`),
    direccion: z.string().trim().min(5, "Escribe la dirección (calle, número, colonia, ciudad)").max(400),
    contacto_nombre: opt(150),
    contacto_telefono: opt(40).refine((v) => !v || v.replace(/\D/g, "").length >= 7, "Teléfono inválido"),
    contacto_correo: opt(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Correo inválido"),
  })
  .superRefine((v, ctx) => {
    if (!v.contacto_telefono && !v.contacto_correo) {
      ctx.addIssue({ code: "custom", path: ["contacto_telefono"], message: "Agrega teléfono o correo del cliente" });
    }
  });
export type CustomerInput = z.input<typeof customerSchema>;

export interface CustomerRecord {
  id: string;
  nombre: string;
  razon_social: string | null;
  rfc: string | null;
  direccion: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_correo: string | null;
  activo: boolean;
}

/** Lo que le falta al cliente para poder enviarle una solicitud (vacio = completo). */
export function customerMissing(c: Pick<CustomerRecord, "nombre" | "rfc" | "direccion" | "contacto_telefono" | "contacto_correo">): string[] {
  const out: string[] = [];
  if (!c.rfc || !RFC_RE.test(c.rfc)) out.push("RFC");
  if (!c.direccion || c.direccion.trim().length < 5) out.push("dirección");
  if (!c.contacto_telefono && !c.contacto_correo) out.push("teléfono o correo");
  return out;
}

/** Busqueda sin acentos ni mayusculas por nombre, razon social, RFC, contacto, telefono o correo. */
export function matchCustomer(c: CustomerRecord, q: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = norm(q.trim());
  if (!t) return true;
  return [c.nombre, c.razon_social, c.rfc, c.contacto_nombre, c.contacto_telefono, c.contacto_correo, c.direccion]
    .filter(Boolean)
    .some((f) => norm(f!).includes(t));
}

/** Columnas de clientes que usan las pantallas. */
export const CUSTOMER_COLS = "id, nombre, razon_social, rfc, direccion, contacto_nombre, contacto_telefono, contacto_correo, activo";
