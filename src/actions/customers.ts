"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_COLS, customerSchema, type CustomerInput, type CustomerRecord } from "@/lib/validation/customer";
import type { Result } from "./requests";

const COLS = CUSTOMER_COLS;
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

  // Nombre unico (sin importar mayusculas): evita duplicar clientes de la base general (el buscador ve todos).
  const { data: found } = await supabase.rpc("buscar_clientes", { p_q: v.nombre, p_limit: 10 });
  const dup = ((found ?? []) as { id: string; nombre: string }[]).filter((c) => c.nombre.trim().toLowerCase() === v.nombre.toLowerCase());
  if (dup?.[0] && dup[0].id !== id) {
    return { ok: false, error: `Ya existe un cliente llamado "${dup[0].nombre}". Búscalo en la lista.`, fields: { nombre: "Ya existe" } };
  }

  const q = id
    ? supabase.from("customers").update(v).eq("id", id).select(COLS).single()
    : supabase.from("customers").insert({ ...v, created_by: u.id }).select(COLS).single();
  const { data, error } = await q;
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor/clientes");
  revalidatePath("/comprador/clientes");
  revalidatePath("/ventas/clientes");
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

/** Buscador de clientes (los vendedores no ven la lista completa): minimo 2 letras, maximo 10 resultados. */
export async function searchCustomersAction(q: string): Promise<CustomerRecord[]> {
  await requireUser();
  const term = z.string().trim().min(2).max(80).safeParse(q);
  if (!term.success) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("buscar_clientes", { p_q: term.data, p_limit: 10 });
  return ((data ?? []) as CustomerRecord[]).map((c) => ({ ...c }));
}

/** El prospecto ya compro: pasa a Cliente (queda la fecha y quien lo convirtio). */
export async function convertCustomerAction(id: string): Promise<Result<{ customer: CustomerRecord }>> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Cliente inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").update({ tipo: "cliente" }).eq("id", id).select(COLS).single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/vendedor/bitacora");
  return { ok: true, customer: data as CustomerRecord };
}

/** Comprador o jefa de ventas: regresar a prospecto (la base lo valida). */
export async function setCustomerKindAction(id: string, tipo: "cliente" | "prospecto"): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Cliente inválido" };
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update({ tipo }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/clientes");
  revalidatePath("/ventas/clientes");
  return { ok: true };
}
