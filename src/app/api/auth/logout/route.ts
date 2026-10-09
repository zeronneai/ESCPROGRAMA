import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // Si aun debe cambiar la contrasena, la BD rechaza el registro; no bloquea el cierre.
  await supabase.rpc("log_event", { p_action: "logout", p_entity: "profiles", p_entity_id: "self" });
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
