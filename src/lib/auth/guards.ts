import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/auth/route-guard";

export interface SessionUser {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  must_change_password: boolean;
}

/** Usuario activo con sesion valida; null si no. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  let { data } = await supabase.auth.getUser();
  if (!data.user) {
    // Un tropiezo de red con Auth no debe mandar al usuario al login: se reintenta una vez.
    await new Promise((r) => setTimeout(r, 300));
    ({ data } = await supabase.auth.getUser());
    if (!data.user) return null;
  }
  const leer = () => supabase.from("profiles").select("id, nombre, correo, rol, activo, must_change_password").eq("id", data.user!.id).maybeSingle();
  let { data: p, error } = await leer();
  if (error) {
    await new Promise((r) => setTimeout(r, 300));
    ({ data: p, error } = await leer());
  }
  if (!p || !p.activo) return null;
  return {
    id: p.id,
    email: p.correo,
    nombre: p.nombre,
    rol: p.rol,
    must_change_password: p.must_change_password,
  };
}

/** Para paginas y acciones: exige sesion activa que ya cambio la contrasena temporal. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (u.must_change_password) redirect("/cambiar-password");
  return u;
}

/** Exige comprador activo. Se usa antes de cualquier uso de service_role. */
export async function requireBuyer(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.rol !== "comprador") throw new Error("No autorizado");
  return u;
}
