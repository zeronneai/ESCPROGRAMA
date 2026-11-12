/**
 * Decision pura de acceso por ruta (se usa en el middleware y se prueba aparte).
 */
import { CATALOGO_VISIBLE } from "@/lib/marca";
export type Rol = "vendedor" | "comprador" | "jefe_ventas" | "gerente" | "coordinador_iso" | "marketplaces" | "almacen" | "supervisor_almacen" | "supervisor_finanzas" | "ceo";

export interface GuardProfile {
  activo: boolean;
  must_change_password: boolean;
  rol: Rol;
}

export type GuardDecision =
  | { type: "next" }
  | { type: "redirect"; to: string; signOut?: boolean }
  | { type: "deny"; status: 401 | 403; error: string };

export const CHANGE_PASSWORD_PATH = "/cambiar-password";
export const LOGIN_PATH = "/login";

export function homeFor(_rol: Rol): string {
  // Todos los puestos entran a su tablero de inicio.
  void _rol;
  return "/inicio";
}

const isApi = (p: string) => p === "/api" || p.startsWith("/api/");

export function decideRoute(input: {
  pathname: string;
  hasUser: boolean;
  profile: GuardProfile | null;
}): GuardDecision {
  const { pathname, hasUser, profile } = input;

  // El cron y la entrada de leads del sitio web se autentican con su propio secreto.
  if (pathname.startsWith("/api/cron/") || pathname === "/api/leads/entrada") return { type: "next" };
  // Encuesta de satisfaccion: el cliente la abre con su link, sin cuenta.
  if (pathname.startsWith("/encuesta/")) return { type: "next" };
  // Catalogo: se le manda al cliente por WhatsApp o correo, se abre sin cuenta.
  if (pathname === "/catalogo" || pathname === "/catalogo-esc-2026.pdf") {
    // Oculto mientras se termina (CATALOGO_VISIBLE): la liga no abre.
    if (!CATALOGO_VISIBLE) return { type: "redirect", to: hasUser ? "/inicio" : LOGIN_PATH };
    return { type: "next" };
  }
  // Link de quejas: el cliente manda su queja sin cuenta (va en tarjetas y firmas de correo).
  if (pathname === "/quejas") return { type: "next" };
  // Cerrar sesion siempre se puede, aunque la sesion ya haya vencido: regresa al inicio de sesion.
  if (pathname === "/api/auth/logout") return { type: "next" };

  if (!hasUser) {
    if (pathname === LOGIN_PATH) return { type: "next" };
    if (isApi(pathname)) return { type: "deny", status: 401, error: "no_autenticado" };
    return { type: "redirect", to: LOGIN_PATH };
  }

  if (!profile || !profile.activo) {
    if (pathname === LOGIN_PATH) return { type: "next" };
    if (isApi(pathname)) return { type: "deny", status: 403, error: "usuario_inactivo" };
    return { type: "redirect", to: `${LOGIN_PATH}?error=inactivo`, signOut: true };
  }

  if (profile.must_change_password) {
    if (pathname === CHANGE_PASSWORD_PATH || pathname === "/api/auth/logout") {
      return { type: "next" };
    }
    if (isApi(pathname)) {
      return { type: "deny", status: 403, error: "debe_cambiar_contrasena" };
    }
    return { type: "redirect", to: CHANGE_PASSWORD_PATH };
  }

  if (pathname === LOGIN_PATH || pathname === CHANGE_PASSWORD_PATH || pathname === "/") {
    return { type: "redirect", to: homeFor(profile.rol) };
  }

  if (pathname.startsWith("/comprador") && profile.rol !== "comprador") {
    return isApi(pathname)
      ? { type: "deny", status: 403, error: "sin_permiso" }
      : { type: "redirect", to: homeFor(profile.rol) };
  }
  if (pathname.startsWith("/vendedor") && profile.rol !== "vendedor") {
    return { type: "redirect", to: homeFor(profile.rol) };
  }
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  // Resumen de ventas: jefa de ventas, gerente, coordinador ISO y comprador (solo lectura salvo la jefa).
  if (under("/ventas") && !["jefe_ventas", "gerente", "coordinador_iso", "comprador", "ceo"].includes(profile.rol)) {
    return { type: "redirect", to: homeFor(profile.rol) };
  }
  // Quejas y acciones correctivas: todos menos Marketplaces.
  // (El analisis de riesgo si lo hacen almacen y finanzas: cada jefe de area el de su proceso.)
  const riesgo = under("/calidad/riesgos") && profile.rol !== "marketplaces";
  if (!riesgo && under("/calidad") && ["marketplaces", "almacen", "supervisor_almacen", "supervisor_finanzas"].includes(profile.rol)) {
    return { type: "redirect", to: homeFor(profile.rol) };
  }
  // Pagos a proveedores extranjeros: comprador y CEO.
  if (under("/pagos") && profile.rol !== "comprador" && profile.rol !== "ceo") {
    return { type: "redirect", to: homeFor(profile.rol) };
  }
  if (pathname.startsWith("/api/admin") && profile.rol !== "comprador") {
    return { type: "deny", status: 403, error: "sin_permiso" };
  }
  return { type: "next" };
}
