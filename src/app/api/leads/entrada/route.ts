import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { webLeadSchema } from "@/lib/validation/lead";

/**
 * Entrada de leads desde el formulario del sitio web (o Zapier, Make, etc.).
 *
 * POST /api/leads/entrada
 *   Header:  Authorization: Bearer <LEADS_WEBHOOK_SECRET>
 *   Body:    JSON o form-urlencoded con empresa (obligatorio), nombre, puesto, telefono, correo,
 *            ciudad, industria, producto, mensaje, pagina, externo_id. "website" es un campo trampa.
 *
 * El lead entra SIN vendedor (todos los vendedores lo ven y uno lo toma) con origen "sitio_web",
 * y se avisa a los vendedores activos con una notificacion en el portal.
 * El secreto NUNCA debe ir en el navegador: el formulario del sitio lo manda desde su servidor.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.LEADS_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "entrada_deshabilitada" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || req.headers.get("x-leads-secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "no_autorizado" }, { status: 401 });

  let raw: Record<string, unknown>;
  try {
    const type = req.headers.get("content-type") ?? "";
    raw = type.includes("application/json") ? await req.json() : Object.fromEntries((await req.formData()).entries());
  } catch {
    return NextResponse.json({ error: "cuerpo_invalido" }, { status: 400 });
  }
  const parsed = webLeadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "datos_invalidos", detalle: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 422 });
  }
  const v = parsed.data;
  if (v.website) return NextResponse.json({ ok: true }); // spam: se acepta sin guardar
  const correo = v.correo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo) ? v.correo : null;
  const telefono = v.telefono?.replace(/[^\d+()\-.\s]/g, "").slice(0, 40) || null;
  if (!correo && !telefono) return NextResponse.json({ error: "falta_contacto", detalle: ["Envia telefono o correo"] }, { status: 422 });

  const admin = createAdminClient();
  const notas = [v.mensaje && `Mensaje del formulario: ${v.mensaje}`].filter(Boolean).join("\n") || null;
  const { data, error } = await admin
    .from("leads")
    .insert({
      empresa: v.empresa,
      contacto_nombre: v.nombre || null,
      contacto_puesto: v.puesto || null,
      telefono,
      correo,
      ciudad: v.ciudad || null,
      industria: v.industria || null,
      producto_interes: v.producto || null,
      origen: "sitio_web",
      origen_detalle: v.pagina || null,
      notas,
      externo_id: v.externo_id || null,
    })
    .select("id")
    .single();
  if (error) {
    if (/duplicate key/i.test(error.message)) return NextResponse.json({ ok: true, duplicado: true });
    return NextResponse.json({ error: "no_guardado" }, { status: 500 });
  }

  const { data: sellers } = await admin.from("profiles").select("id").eq("rol", "vendedor").eq("activo", true);
  if (sellers?.length) {
    await admin.from("notifications").insert(
      sellers.map((s) => ({
        user_id: s.id,
        tipo: "lead_nuevo",
        titulo: `Nuevo lead del sitio web: ${v.empresa}`,
        cuerpo: v.producto ? `Le interesa: ${v.producto.slice(0, 140)}` : null,
        link: `/vendedor/leads/${data.id}`,
        ref_id: data.id,
      })),
    );
  }
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
