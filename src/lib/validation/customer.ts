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

export const ESTADOS_MX = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México",
  "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán",
  "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa",
  "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas", "Extranjero",
] as const;

export type CustomerKind = "cliente" | "prospecto";
export const KIND_LABEL: Record<CustomerKind, string> = { cliente: "Cliente", prospecto: "Prospecto" };

/** Alta y edicion de clientes (misma regla que la base de datos). El RFC es obligatorio para clientes. */
export const customerSchema = z
  .object({
    tipo: z.enum(["cliente", "prospecto"], { message: "Elige si es cliente o prospecto" }),
    nombre: z.string().trim().min(2, "Escribe el nombre del cliente").max(200),
    razon_social: opt(250),
    giro: z.string().trim().min(2, "Escribe el giro de la empresa").max(150),
    estado_geo: z.string().trim().min(2, "Elige el estado").max(60),
    rfc: z
      .string()
      .transform(normalizeRfc)
      .refine((v) => v === "" || RFC_RE.test(v), `RFC inválido (12 o 13 caracteres; extranjero: ${RFC_EXTRANJERO})`)
      .transform((v) => (v ? v : null)),
    direccion: z.string().trim().min(5, "Escribe la dirección (calle, número, colonia, ciudad)").max(400),
    contacto_nombre: opt(150),
    contacto_telefono: opt(40).refine((v) => !v || v.replace(/\D/g, "").length >= 7, "Teléfono inválido"),
    contacto_correo: opt(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Correo inválido"),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "cliente" && !v.rfc) ctx.addIssue({ code: "custom", path: ["rfc"], message: "El RFC es obligatorio para clientes" });
    if (!v.contacto_telefono && !v.contacto_correo) {
      ctx.addIssue({ code: "custom", path: ["contacto_telefono"], message: "Agrega teléfono o correo del cliente" });
    }
  });
export type CustomerInput = z.input<typeof customerSchema>;

export interface CustomerRecord {
  id: string;
  tipo: CustomerKind;
  nombre: string;
  giro: string | null;
  estado_geo: string | null;
  razon_social: string | null;
  rfc: string | null;
  direccion: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_correo: string | null;
  activo: boolean;
  tipo_inicial?: CustomerKind;
  convertido_at?: string | null;
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
  return [c.nombre, c.razon_social, c.rfc, c.contacto_nombre, c.contacto_telefono, c.contacto_correo, c.direccion, c.giro, c.estado_geo]
    .filter(Boolean)
    .some((f) => norm(f!).includes(t));
}

/** Columnas de clientes que usan las pantallas. */
export const CUSTOMER_COLS = "id, tipo, nombre, razon_social, giro, estado_geo, rfc, direccion, contacto_nombre, contacto_telefono, contacto_correo, activo, tipo_inicial, convertido_at";

/** Lo que falta para la bitacora (formato ESC-VEN-FR-002): giro, estado, direccion y contacto. */
export function bitacoraMissing(c: Pick<CustomerRecord, "giro" | "estado_geo" | "direccion" | "contacto_telefono" | "contacto_correo">): string[] {
  const out: string[] = [];
  if (!c.giro) out.push("giro");
  if (!c.estado_geo) out.push("estado");
  if (!c.direccion) out.push("dirección");
  if (!c.contacto_telefono && !c.contacto_correo) out.push("teléfono o correo");
  return out;
}
