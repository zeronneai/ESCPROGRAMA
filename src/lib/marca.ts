/** Nombre y textos de la plataforma interna de ESC Representaciones. */
export const APP_NOMBRE = "ESC One";
export const APP_LEMA = "Todo ESC Representaciones en un solo lugar";
export const APP_TITULO = `${APP_NOMBRE} | ESC Representaciones`;

/**
 * Catalogo visible en el portal y por liga publica. Apagado mientras se termina el PDF:
 * se esconde en Inicio, Documentos, Prospeccion y el menu, y /catalogo no abre. Cambiar a true para mostrarlo.
 */
export const CATALOGO_VISIBLE = true;

/** Catalogo vigente: archivo publico (se puede mandar a clientes sin que inicien sesion). */
/** version: al cambiarla sale otra vez el aviso del catalogo nuevo a todos. */
export const CATALOGO = { nombre: "Catálogo ESC 2026", archivo: "/catalogo-esc-2026.pdf?v=20261112", ruta: "/catalogo", version: "2026-11-12" };

/** Mensaje para mandar el catalogo a un cliente. */
export function mensajeCatalogo(url: string, contacto?: string | null) {
  const hola = contacto?.trim() ? `Hola ${contacto.trim().split(" ")[0]}` : "Hola";
  return `${hola}, te comparto el catálogo 2026 de ESC Representaciones: guantes, desechables, ropa ESD, limpieza para cuarto limpio y materiales de refuerzo. ${url}\n\nCualquier duda o cotización, aquí estoy.`;
}
