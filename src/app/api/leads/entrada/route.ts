import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { webLeadSchema } from "@/lib/validation/lead";
import { ESTADOS_MX } from "@/lib/validation/customer";

/**
 * Entrada de leads desde el formulario del sitio web (o Zapier, Make, etc.).
 *
 * POST /api/leads/entrada
 *   Header:  Authorization: Bearer <LEADS_WEBHOOK_SECRET>
 *   Body:    JSON o form-urlencoded con empresa (obligatorio), nombre, puesto, telefono, correo,
 *            ciudad, industria, producto, mensaje, pagina, externo_id. "website" es un campo trampa.
 *
 * Entra a la Bitacora (Prospeccion) SIN vendedor (todos los vendedores lo ven y uno lo toma) con origen
 * "sitio_web"; la empresa se da de alta como prospecto si no existe. Se avisa a los vendedores activos con una notificacion en el portal.
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
  if (v.externo_id) {
    const { data: dup } = await admin.from("bitacora").select("id").eq("externo_id", v.externo_id).maybeSingle();
    if (dup) return NextResponse.json({ ok: true, duplicado: true, id: dup.id });
  }

  // Cliente: se reutiliza si ya existe (mismo nombre, correo o telefono); si no, se da de alta como prospecto.
  const empresa = v.empresa.trim();
  const ciudad = v.ciudad?.trim() || null;
  const estado = ciudad ? ESTADOS_MX.find((e) => norm(ciudad).includes(norm(e))) ?? null : null;
  let customerId: string | null = null;
  {
    const { data: byName } = await admin.from("customers").select("id").ilike("nombre", like(empresa)).limit(1);
    customerId = byName?.[0]?.id ?? null;
    if (!customerId && correo) customerId = (await admin.from("customers").select("id").ilike("contacto_correo", like(correo)).limit(1)).data?.[0]?.id ?? null;
  }
  if (!customerId) {
    const { data: c, error: ce } = await admin
      .from("customers")
      .insert({
        nombre: empresa,
        tipo: "prospecto",
        giro: v.industria || null,
        estado_geo: estado,
        direccion: ciudad,
        contacto_nombre: v.nombre ? [v.nombre, v.puesto].filter(Boolean).join(", ") : null,
        contacto_telefono: telefono,
        contacto_correo: correo,
      })
      .select("id")
      .single();
    if (ce) return NextResponse.json({ error: "no_guardado" }, { status: 500 });
    customerId = c.id;
  }

  const comentarios = [v.mensaje && `Mensaje del formulario: ${v.mensaje}`, v.pagina && `Página: ${v.pagina}`].filter(Boolean).join("\n").slice(0, 4000) || null;
  const { data, error } = await admin
    .from("bitacora")
    .insert({
      customer_id: customerId,
      vendedor_id: null,
      necesidad: v.producto?.slice(0, 1000) || null,
      comentarios,
      origen: "sitio_web",
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
        titulo: `Nuevo prospecto del sitio web: ${empresa}`,
        cuerpo: v.producto ? `Le interesa: ${v.producto.slice(0, 140)}` : null,
        link: `/vendedor/bitacora/${data.id}`,
        ref_id: data.id,
      })),
    );
  }
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const like = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
