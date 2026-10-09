"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const factor = z.coerce.number({ message: "Numero invalido" }).gt(0, "Debe ser mayor a 0").lte(10, "Maximo 10");

const pricingSchema = z.object({
  markupPct: z.coerce.number({ message: "Numero invalido" }).min(0, "No puede ser negativo").max(100, "Maximo 100%"),
  p1: factor, p2: factor, p3: factor, p4: factor, p5: factor,
});

/** Cada cambio agrega una fila nueva (con fecha y usuario); las cotizaciones pasadas conservan su snapshot. */
export async function savePricingAction(input: Record<string, string>): Promise<Result> {
  const u = await requireBuyer();
  const parsed = pricingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("pricing_config").insert({
    no_shipping_markup: Math.round(v.markupPct * 100) / 10000,
    p1: v.p1, p2: v.p2, p3: v.p3, p4: v.p4, p5: v.p5,
    created_by: u.id,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/configuracion");
  return { ok: true };
}

const settingsSchema = z.object({
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("es-MX", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Zona horaria invalida (ej. America/Chihuahua)"),
  sla: z.coerce.number().int("Debe ser entero").min(1).max(720),
  warn: z.coerce.number().int("Debe ser entero").min(1).max(720),
});

export async function saveSettingsAction(input: Record<string, string>): Promise<Result> {
  const u = await requireBuyer();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsed.data.warn >= parsed.data.sla) return { ok: false, error: "El aviso previo debe ser menor al plazo" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      timezone: parsed.data.timezone,
      sla_business_hours: parsed.data.sla,
      warn_business_hours: parsed.data.warn,
      updated_by: u.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/configuracion");
  return { ok: true };
}

export async function addHolidayAction(input: { fecha: string; descripcion: string }): Promise<Result> {
  const u = await requireBuyer();
  const parsed = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha invalida"), descripcion: z.string().trim().max(120) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert({ fecha: parsed.data.fecha, descripcion: parsed.data.descripcion || null, created_by: u.id });
  if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ese dia ya esta registrado" : friendlyError(error.message) };
  revalidatePath("/comprador/configuracion");
  return { ok: true };
}

export async function removeHolidayAction(fecha: string): Promise<Result> {
  await requireBuyer();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "Fecha invalida" };
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("fecha", fecha);
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath("/comprador/configuracion");
  return { ok: true };
}

// ---- Clientes (catalogo) -----------------------------------------------------
const customerSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre"),
  tipo: z.enum(["cliente", "prospecto"]),
});

export async function createCustomerBuyerAction(input: { nombre: string; tipo: string }): Promise<Result> {
  const u = await requireBuyer();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({ ...parsed.data, created_by: u.id });
  if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ya existe un cliente con ese nombre" : friendlyError(error.message) };
  revalidatePath("/comprador/clientes");
  return { ok: true };
}

export async function updateCustomerAction(id: string, input: { nombre: string; tipo: string; activo: boolean }): Promise<Result> {
  await requireBuyer();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Cliente invalido" };
  const parsed = customerSchema.extend({ activo: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: /duplicate/i.test(error.message) ? "Ya existe un cliente con ese nombre" : friendlyError(error.message) };
  revalidatePath("/comprador/clientes");
  return { ok: true };
}
