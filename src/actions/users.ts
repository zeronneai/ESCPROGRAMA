"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/guards";
import { generateTempPassword, passwordSchema } from "@/lib/auth/password";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type UserActionResult =
  | { ok: true; tempPassword?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const createSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre"),
  correo: z.string().trim().toLowerCase().email("Correo invalido"),
  password: passwordSchema,
  comprador: z.boolean().default(false),
});

const BAN_FOREVER = "876000h";

/**
 * Alta directa. Todas las acciones de este archivo verifican primero que quien
 * llama sea comprador activo (requireBuyer) antes de usar service_role, y la BD
 * vuelve a validar el rol en cada RPC.
 */
export async function createUserAction(input: {
  nombre: string;
  correo: string;
  password: string;
  comprador: boolean;
}): Promise<UserActionResult> {
  await requireBuyer();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, error: "Revisa los datos", fieldErrors };
  }
  const { nombre, correo, password, comprador } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: correo,
    password,
    email_confirm: true,
    user_metadata: { nombre },
  });
  if (error || !data.user) {
    const dup = /already|registered|exists/i.test(error?.message ?? "");
    return {
      ok: false,
      error: dup ? "Ya existe un usuario con ese correo" : "No se pudo crear el usuario",
      fieldErrors: dup ? { correo: "Ya existe" } : undefined,
    };
  }

  const supabase = await createClient();
  const { error: rpcError } = await supabase.rpc("admin_create_profile", {
    p_id: data.user.id,
    p_nombre: nombre,
    p_correo: correo,
    p_rol: comprador ? "comprador" : "vendedor",
  });
  if (rpcError) {
    // Compensacion: no dejar un usuario de Auth sin perfil.
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: "No se pudo crear el perfil del usuario" };
  }
  revalidatePath("/comprador/usuarios");
  // La contraseña temporal solo se devuelve aqui para mostrarse una vez; no se guarda ni se registra.
  return { ok: true, tempPassword: password };
}

export async function resetPasswordAction(userId: string): Promise<UserActionResult> {
  await requireBuyer();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: "Usuario invalido" };

  const supabase = await createClient();
  // Primero se marca el cambio obligatorio (valida rol del llamador en la BD).
  const { error: rpcError } = await supabase.rpc("admin_flag_password_reset", { p_id: userId });
  if (rpcError) return { ok: false, error: "No se pudo restablecer la contraseña" };

  const temp = generateTempPassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password: temp });
  if (error) return { ok: false, error: "No se pudo restablecer la contraseña" };
  revalidatePath("/comprador/usuarios");
  return { ok: true, tempPassword: temp };
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<UserActionResult> {
  await requireBuyer();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: "Usuario invalido" };

  const supabase = await createClient();
  const { error: rpcError } = await supabase.rpc("admin_set_user_active", { p_id: userId, p_active: active });
  if (rpcError) return { ok: false, error: rpcError.message };

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : BAN_FOREVER,
  });
  if (error) return { ok: false, error: "El perfil se actualizo, pero no se pudo bloquear el acceso en Auth" };
  revalidatePath("/comprador/usuarios");
  return { ok: true };
}

export async function updateUserNameAction(userId: string, nombre: string): Promise<UserActionResult> {
  await requireBuyer();
  const parsed = z.object({ id: z.string().uuid(), nombre: z.string().trim().min(2) }).safeParse({ id: userId, nombre });
  if (!parsed.success) return { ok: false, error: "Nombre invalido" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_user", { p_id: parsed.data.id, p_nombre: parsed.data.nombre });
  if (error) return { ok: false, error: "No se pudo actualizar" };
  revalidatePath("/comprador/usuarios");
  return { ok: true };
}
