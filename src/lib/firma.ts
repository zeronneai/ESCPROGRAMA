/** Firma de correo: datos que llena cada usuario y valores por omision. */
import { z } from "zod";

export const firmaSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(80),
  puesto: z.string().trim().max(80).default(""),
  correo: z.string().trim().max(120).default(""),
  telefono: z.string().trim().max(60).default(""),
  telefono2: z.string().trim().max(60).default(""),
  direccion: z.string().trim().max(200).default(""),
  web: z.string().trim().max(80).default(""),
  leyenda: z.string().trim().max(140).default(""),
  link: z.string().trim().max(120).default(""),
});
export type Firma = z.infer<typeof firmaSchema>;

export const LEYENDA_QUEJAS = "¿Algo no salió como esperaba? Envíenos su queja o sugerencia:";

/** Puesto sugerido segun el rol. */
export const PUESTO_FIRMA: Record<string, string> = {
  vendedor: "Ejecutivo de ventas",
  jefe_ventas: "Jefa de ventas",
  comprador: "Compras",
  gerente: "Gerencia",
  coordinador_iso: "Coordinación de calidad",
  marketplaces: "Marketplaces",
  almacen: "Almacén",
  supervisor_almacen: "Supervisión de almacén",
  supervisor_finanzas: "Administración y finanzas",
  ceo: "Dirección general",
};

/** Roles a los que la ventana de firma les aparece sola hasta que la descarguen. */
export const FIRMA_AUTO_ROLES = ["vendedor", "jefe_ventas"];

/** El link sin "https://" para que se lea limpio en la imagen. */
export const linkCorto = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Nombre del archivo: firma-ana-torres.png */
export const archivoFirma = (nombre: string) =>
  `firma-${nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "esc"}.png`;

/** Evento para abrir la ventana de firma desde el menu del usuario. */
export const ABRIR_FIRMA = "esc:firma";
