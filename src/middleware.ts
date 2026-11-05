import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideRoute, type GuardProfile } from "@/lib/auth/route-guard";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser valida el token contra Auth (no solo la cookie).
  const { data, error } = await supabase.auth.getUser();
  let user = data.user;
  // Una falla momentanea (red, limite de Auth, 5xx) NO es "sin sesion": se usa la sesion de la cookie
  // para no sacar al usuario. Solo un token invalido o ausente cuenta como sesion cerrada.
  if (!user && error && !esSesionInvalida(error)) {
    const { data: s } = await supabase.auth.getSession();
    user = s.session?.user ?? null;
    if (user) return response;
  }
  let profile: GuardProfile | null = null;
  if (user) {
    const { data: p, error: pErr } = await supabase
      .from("profiles")
      .select("activo, must_change_password, rol")
      .eq("id", user.id)
      .maybeSingle();
    // Si la consulta fallo (no es que el usuario no exista), se deja pasar: la pagina vuelve a validar.
    if (pErr) return response;
    profile = (p as GuardProfile | null) ?? null;
  }

  const decision = decideRoute({
    pathname: request.nextUrl.pathname,
    hasUser: !!user,
    profile,
  });

  if (decision.type === "deny") {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }
  if (decision.type === "redirect") {
    // Solo cierra la sesion de este navegador (no la de los demas dispositivos).
    if (decision.signOut) await supabase.auth.signOut({ scope: "local" });
    const url = request.nextUrl.clone();
    const [path, query] = decision.to.split("?");
    url.pathname = path;
    url.search = query ? `?${query}` : "";
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

/** Token ausente, vencido sin poder renovarse o revocado. Lo demas (red, 429, 5xx) es momentaneo. */
function esSesionInvalida(error: { name?: string; status?: number; message?: string }): boolean {
  if (error.name === "AuthSessionMissingError") return true;
  if (error.status === 401 || error.status === 403) return true;
  if (error.status === 400 && /refresh token|jwt|session/i.test(error.message ?? "")) return true;
  return false;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-esc.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
