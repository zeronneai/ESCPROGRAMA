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
  const { data } = await supabase.auth.getUser();
  let profile: GuardProfile | null = null;
  if (data.user) {
    const { data: p } = await supabase
      .from("profiles")
      .select("activo, must_change_password, rol")
      .eq("id", data.user.id)
      .maybeSingle();
    profile = (p as GuardProfile | null) ?? null;
  }

  const decision = decideRoute({
    pathname: request.nextUrl.pathname,
    hasUser: !!data.user,
    profile,
  });

  if (decision.type === "deny") {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }
  if (decision.type === "redirect") {
    if (decision.signOut) await supabase.auth.signOut();
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo-esc.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
