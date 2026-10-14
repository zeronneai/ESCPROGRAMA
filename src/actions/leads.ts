"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import { activitySchema, leadSchema, stageSchema, type ActivityInput, type LeadInput } from "@/lib/validation/lead";
import type { LeadStage } from "@/lib/leads/types";
import type { Result } from "./requests";

async function requireSeller() {
  const u = await requireUser();
  if (u.rol !== "vendedor") throw new Error("No autorizado");
  return u;
}
const uuid = z.string().uuid();
const refresh = (id?: string) => {
  revalidatePath("/vendedor/leads");
  if (id) revalidatePath(`/vendedor/leads/${id}`);
};
type FieldErrors = Record<string, string>;
const fieldErrors = (issues: z.core.$ZodIssue[]): FieldErrors =>
  Object.fromEntries(issues.map((i) => [String(i.path[0] ?? "form"), i.message]));

export async function createLeadAction(input: LeadInput): Promise<Result<{ id: string }> & { fields?: FieldErrors }> {
  const u = await requireSeller();
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fields: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({ ...parsed.data, vendedor_id: u.id, created_by: u.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh();
  return { ok: true, id: data.id };
}

export async function updateLeadAction(id: string, input: LeadInput): Promise<Result & { fields?: FieldErrors }> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Lead inválido" };
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, fields: fieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").update({ ...parsed.data, vendedor_id: u.id }).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar este lead." };
  refresh(id);
  return { ok: true };
}

export async function changeStageAction(id: string, etapa: LeadStage, motivo?: string): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Lead inválido" };
  const parsed = stageSchema.safeParse({ etapa, motivo_perdida: motivo });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ etapa: parsed.data.etapa, motivo_perdida: parsed.data.motivo_perdida, vendedor_id: u.id })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar este lead." };
  refresh(id);
  return { ok: true };
}

/** Registra un contacto (llamada, WhatsApp, correo...) y opcionalmente agenda el siguiente seguimiento. */
export async function addActivityAction(leadId: string, input: ActivityInput): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(leadId).success) return { ok: false, error: "Lead inválido" };
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.tipo === "nota" && !v.nota) return { ok: false, error: "Escribe la nota" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_activities")
    .insert({ lead_id: leadId, tipo: v.tipo, resultado: v.resultado, nota: v.nota, created_by: u.id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (v.proximo_seguimiento) {
    const { error: e2 } = await supabase.from("leads").update({ proximo_seguimiento: v.proximo_seguimiento }).eq("id", leadId);
    if (e2) return { ok: false, error: friendlyError(e2.message) };
  }
  refresh(leadId);
  return { ok: true };
}

/** Un lead sin vendedor (por ejemplo del sitio web) pasa a ser del vendedor que lo toma. */
export async function claimLeadAction(id: string): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Lead inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("leads").update({ vendedor_id: u.id }).eq("id", id).is("vendedor_id", null).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "Otro vendedor ya tomó este lead." };
  refresh(id);
  return { ok: true };
}

export async function convertLeadAction(id: string, nombre?: string): Promise<Result<{ customerId: string }>> {
  await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Lead inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_lead_to_customer", { p_lead: id, p_nombre: nombre?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true, customerId: data as string };
}

/** Crea o vincula el cliente (como prospecto) para poder levantar una solicitud de cotizacion. */
export async function linkLeadCustomerAction(id: string): Promise<Result<{ customerId: string }>> {
  await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Lead inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_lead_customer", { p_lead: id });
  if (error) return { ok: false, error: friendlyError(error.message) };
  refresh(id);
  return { ok: true, customerId: data as string };
}

export async function archiveLeadAction(id: string, archive: boolean): Promise<Result> {
  const u = await requireSeller();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Lead inválido" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ archived_at: archive ? new Date().toISOString() : null, vendedor_id: u.id })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "No tienes permiso para editar este lead." };
  refresh(id);
  return { ok: true };
}
