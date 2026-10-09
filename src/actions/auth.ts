"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { passwordSchema } from "@/lib/auth/password";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const loginSchema = z.object({
  correo: z.string().trim().email("Correo invalido"),
  password: z.string().min(1, "Escribe tu contraseña"),
});

export async function loginAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.correo.toLowerCase(),
    password: parsed.data.password,
  });
  if (error) return { error: "Correo o contraseña incorrectos, o el usuario esta desactivado." };

  const { error: touchError } = await supabase.rpc("touch_login");
  if (touchError) {
    await supabase.auth.signOut();
    return { error: "Tu usuario esta desactivado. Contacta al administrador." };
  }
  redirect("/");
}

const changeSchema = z
  .object({
    actual: z.string().min(1, "Escribe tu contraseña actual"),
    nueva: passwordSchema,
    confirmar: z.string(),
  })
  .refine((v) => v.nueva === v.confirmar, { path: ["confirmar"], message: "No coincide" })
  .refine((v) => v.nueva !== v.actual, {
    path: ["nueva"],
    message: "Debe ser distinta de la contraseña actual",
  });

export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = changeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }

  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user?.email) redirect("/login");

  // Confirma que conoce la contraseña actual (la temporal).
  const check = await supabase.auth.signInWithPassword({
    email: u.user.email,
    password: parsed.data.actual,
  });
  if (check.error) return { fieldErrors: { actual: "Contraseña actual incorrecta" } };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.nueva });
  if (error) return { error: "No se pudo actualizar la contraseña. Intenta con otra." };

  const { error: rpcError } = await supabase.rpc("complete_password_change");
  if (rpcError) return { error: "No se pudo completar el cambio. Intenta de nuevo." };
  redirect("/");
}
