"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guards";
import { friendlyError } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./requests";

async function requireSeller() {
  const u = await requireUser();
  if (u.rol !== "vendedor") throw new Error("No autorizado");
  return u;
}

/** Guarda el precio elegido al elegirlo (editable hasta marcar "Enviado"; despues queda fijo por version). */
export async function choosePriceAction(itemId: string, precio: number): Promise<Result> {
  await requireSeller();
  const parsed = z.object({ itemId: z.string().uuid(), precio: z.number().int().min(1).max(5) }).safeParse({ itemId, precio });
  if (!parsed.success) return { ok: false, error: "Elige uno de los 5 precios" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_price_choice", { p_item: parsed.data.itemId, p_precio: parsed.data.precio });
  if (error) return { ok: false, error: friendlyError(error.message) };
  return { ok: true };
}

const pdfSchema = z
  .object({
    requestId: z.string().uuid(),
    destino: z.string().trim().max(300),
    via: z.string().trim().max(120),
    condiciones: z.string().trim().max(120),
    atencion: z.string().trim().max(200),
    modo: z.enum(["incluido", "aparte"]),
    monto: z.string().optional(),
    moneda: z.enum(["MXN", "USD"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.modo === "aparte") {
      const n = Number((v.monto ?? "").replace(/,/g, ""));
      if (!(n > 0)) ctx.addIssue({ code: "custom", path: ["monto"], message: "Captura el monto del envío" });
      if (!v.moneda) ctx.addIssue({ code: "custom", path: ["moneda"], message: "Elige la moneda del envío" });
    }
  });
export type PdfDataInput = z.infer<typeof pdfSchema>;

/** Datos del PDF: destino, via, condiciones, atencion y cargo de envio al cliente (por solicitud y revision). */
export async function savePdfDataAction(input: PdfDataInput): Promise<Result> {
  await requireSeller();
  const parsed = pdfSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_pdf_data", {
    p_request: v.requestId,
    p_destino: v.destino || null,
    p_via: v.via || null,
    p_condiciones: v.condiciones || null,
    p_atencion: v.atencion || null,
    p_modo: v.modo,
    p_monto: v.modo === "aparte" ? Number((v.monto ?? "").replace(/,/g, "")) : null,
    p_moneda: v.modo === "aparte" ? v.moneda : null,
  });
  if (error) return { ok: false, error: friendlyError(error.message) };
  revalidatePath(`/vendedor/solicitudes/${v.requestId}`);
  return { ok: true };
}
