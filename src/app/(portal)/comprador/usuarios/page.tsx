import { requireBuyer } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { UsersPanel, type UserRow } from "./users-panel";

export default async function UsuariosPage() {
  const me = await requireBuyer();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, nombre, correo, rol, activo, must_change_password, last_login_at, created_at")
    .order("created_at", { ascending: false });
  return <UsersPanel users={(data ?? []) as UserRow[]} meId={me.id} />;
}
