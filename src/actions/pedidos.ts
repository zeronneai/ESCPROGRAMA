"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

const PIDEN = ["vendedor", "jefe_ventas", "gerente", "ceo"];
const refrescar = () => {
  revalidatePath("/pedidos-compras");
  revalidatePath("/comprador/planeacion");
  revalidatePath("/comprador/planeacion/pedidos");
};

/** Buscador del kardex de planeacion (clave o nombre). */
export async function buscarArticulosPlanAction(q: string): Promise<{ clave: string; nombre: string; um: string | null }[]> {
  const u = await requireUser();
  if (!PIDEN.includes(u.rol) && u.rol !== "comprador") return [];
  const t = String(q ?? "").trim().slice(0, 80);
  if (t.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("plan_articulos_buscar", { p_q: t });
  return (data ?? []) as { clave: string; nombre: string; um: string | null }[];
}

const nuevo = z
  .object({
    clave: z.string().trim().min(1).max(60).nullable(),
    descripcion: z.string().trim().min(2, "Escribe qué necesitas.").max(400),
    cantidad: z.number({ error: "Pon la cantidad." }).positive("La cantidad debe ser mayor a 0.").max(1e8),
    um: z.string().trim().max(30).nullable().optional(),
    frecuencia: z.enum(["unica", "semanal", "mensual", "anual"]),
    cliente: z.string().trim().max(200).nullable().optional(),
    notas: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export async function crearPedidoAction(input: z.input<typeof nuevo>): Promise<Result<{ id: string }>> {
  const u = await requireUser();
  if (!PIDEN.includes(u.rol)) return { ok: false, error: "Los pedidos al comprador los hacen ventas, gerencia y dirección." };
  const p = nuevo.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pedidos_vendedor")
    .insert({ ...p.data, um: p.data.um || null, cliente: p.data.cliente || null, notas: p.data.notas || null })
    .select("id")
    .single();
  if (error) return { ok: false, error: /pedidos_vendedor/.test(error.message) && /exist/.test(error.message) ? "Falta correr la actualización 0078 en Supabase." : friendlyError(error.message) };
  refrescar();
  return { ok: true, id: data.id };
}

/** El vendedor cancela su pedido (mientras siga activo); el comprador puede cancelar con una nota. */
export async function cancelarPedidoAction(id: string, nota?: string): Promise<Result> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Pedido inválido" };
  const supabase = await createClient();
  const upd: Record<string, unknown> = { estado: "cancelado" };
  if (nota?.trim()) upd.nota_comprador = nota.trim().slice(0, 1000);
  const { data, error } = await supabase.from("pedidos_vendedor").update(upd).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error.message) };
  if (!data?.length) return { ok: false, error: "Este pedido ya no se puede cancelar." };
  refrescar();
  return { ok: true };
}

/** El comprador marca como pedido (sobre todo los "otro"): con folio de la OC o una nota. */
export async function atenderPedidoAction(id: string, folio: string, nota: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo el comprador." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Pedido inválido" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pedidos_vendedor")
    .update({ estado: "pedido", oc_folio: folio.trim().slice(0, 40) || null, nota_comprador: nota.trim().slice(0, 1000) || null, pedido_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refrescar();
  return { ok: true };
}

/** El comprador regresa un pedido a activo (si lo marco por error). */
export async function reabrirPedidoAction(id: string): Promise<Result> {
  const u = await requireUser();
  if (u.rol !== "comprador") return { ok: false, error: "Solo el comprador." };
  const supabase = await createClient();
  const { error } = await supabase.from("pedidos_vendedor").update({ estado: "activo", oc_id: null, oc_folio: null, pedido_at: null }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error.message) };
  refrescar();
  return { ok: true };
}
