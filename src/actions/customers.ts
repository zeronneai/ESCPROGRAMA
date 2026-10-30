"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { customerSchema, type CustomerInput, type CustomerRecord } from "@/lib/validation/customer";
import type { Result } from "./requests";

const COLS = "id, nombre, razon_social, rfc, direccion, contacto_nombre, contacto_telefono, contacto_correo, activo";
type Fields = Record<string, string>;
const fieldErrors = (issues: z.core.$ZodIssue[]): Fields => Object.fromEntries(issues.map((i) => [String(i.path[0] ?? "form"), i.message]));

/** Alta de cliente en la base general (vendedor o comprador). Si ya existe con ese nombre, se avisa. */
export async function saveCustomerAction(
  id: string | null,
  input: CustomerInput,
): Promise<Result<{ customer: CustomerRecord }> & { fields?: Fields }> {
  const u = await requireUser();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fields: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const v = parsed.data;

  // Nombre unico (sin importar mayusculas): evita duplicar clientes de la base general.
  const { data: dup } = await supabase.from("customers").select("id, nombre").ilike("nombre", v.nombre.replace(/[%_\\]/g, "\\$&")).limit(1);
  if (dup?.[0] && dup[0].id !== id) {
    return { ok: false, error: `Ya existe un cliente llamado "${dup[0].nombre}". Búscalo en la lista.`, fields: { nombre: "Ya existe" } };
  }

  const q = id
    ? supabase.from("customers").update(v).eq("id", id).select(COLS).single()
    : supabase.from("customers").insert({ ...v, tipo: "cliente", created_by: u.id }).select(COLS).single();
  const { data, error } = await q;
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor/clientes");
  revalidatePath("/comprador/clientes");
  return { ok: true, customer: data as CustomerRecord };
}

/** Solo comprador: activar o desactivar (la base lo vuelve a validar). */
export async function setCustomerActiveAction(id: string, activo: boolean): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo el comprador puede desactivar clientes" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Cliente inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/clientes");
  revalidatePath("/vendedor/clientes");
  return { ok: true };
}
