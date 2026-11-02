/**
 * Decision pura de acceso por ruta (se usa en el middleware y se prueba aparte).
 */
export type Rol = "vendedor" | "comprador" | "jefe_ventas" | "gerente" | "coordinador_iso" | "marketplaces" | "almacen";

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

export function homeFor(rol: Rol): string {
  switch (rol) {
    case "comprador":
      return "/comprador";
    case "jefe_ventas":
    case "gerente":
      return "/ventas";
    case "coordinador_iso":
      return "/calidad";
    case "marketplaces":
      return "/guias";
    case "almacen":
      return "/evaluaciones/proveedores";
    default:
      return "/vendedor";
  }
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
  if (under("/ventas") && !["jefe_ventas", "gerente", "coordinador_iso", "comprador"].includes(profile.rol)) {
    return { type: "redirect", to: homeFor(profile.rol) };
  }
  // Quejas y acciones correctivas: todos menos Marketplaces.
  if (under("/calidad") && (profile.rol === "marketplaces" || profile.rol === "almacen")) {
    return { type: "redirect", to: homeFor(profile.rol) };
  }
  if (pathname.startsWith("/api/admin") && profile.rol !== "comprador") {
    return { type: "deny", status: 403, error: "sin_permiso" };
  }
  return { type: "next" };
}
