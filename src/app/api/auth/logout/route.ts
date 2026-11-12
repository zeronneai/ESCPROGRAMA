import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Cerrar sesion: pase lo que pase (sesion vencida, error de red, doble clic, boton Atras) siempre regresa
 * a la pantalla de inicio de sesion.
 */
async function salir(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      // Si aun debe cambiar la contrasena, la BD rechaza el registro; no bloquea el cierre.
      await supabase.rpc("log_event", { p_action: "logout", p_entity: "profiles", p_entity_id: "self" });
      await supabase.auth.signOut({ scope: "local" });
    }
  } catch {
    /* sin sesion o sin conexion: igual se sale */
  }
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  // Por si la sesion quedo a medias: se borran las cookies de Supabase.
  for (const c of request.cookies.getAll()) if (c.name.startsWith("sb-")) res.cookies.delete(c.name);
  return res;
}

export const POST = salir;
export const GET = salir;
