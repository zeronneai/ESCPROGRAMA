/**
 * Decision pura de acceso por ruta (se usa en el middleware y se prueba aparte).
 */
export type Rol = "vendedor" | "comprador";

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
  return rol === "comprador" ? "/comprador" : "/vendedor";
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
  if (pathname.startsWith("/api/admin") && profile.rol !== "comprador") {
    return { type: "deny", status: 403, error: "sin_permiso" };
  }
  return { type: "next" };
}
