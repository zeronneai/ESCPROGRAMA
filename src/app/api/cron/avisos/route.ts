import { NextResponse, type NextRequest } from "next/server";
import { computeDeadlineNotices } from "@/lib/quotes/deadlines";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tarea diaria (Vercel Cron, plan Hobby = una vez al dia). Genera avisos dentro del portal
 * para el comprador. "Vencida" como estado NO depende de esto: se calcula al consultar.
 * Vercel envia  Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const [{ data: s }, { data: h }, { data: reqs }, { data: buyers }] = await Promise.all([
    admin.from("app_settings").select("timezone, warn_business_hours").single(),
    admin.from("holidays").select("fecha"),
    admin
      .from("quote_requests")
      .select("id, folio, due_at, quote_items!inner(estado)")
      .eq("estado", "enviada")
      .is("archived_at", null)
      .eq("quote_items.estado", "pendiente"),
    admin.from("profiles").select("id").eq("rol", "comprador").eq("activo", true),
  ]);

  const notices = computeDeadlineNotices(
    (reqs ?? []).map((r) => ({ id: r.id, folio: r.folio!, due_at: r.due_at! })),
    new Date(),
    {
      timezone: s?.timezone ?? "America/Chihuahua",
      warnHours: s?.warn_business_hours ?? 12,
      holidays: (h ?? []).map((x) => x.fecha),
    },
  );

  let created = 0;
  for (const n of notices) {
    for (const b of buyers ?? []) {
      const { error } = await admin.from("notifications").insert({
        user_id: b.id,
        tipo: n.kind,
        titulo: n.kind === "vencida" ? `Solicitud ${n.folio} vencida` : `Solicitud ${n.folio} por vencer`,
        cuerpo:
          n.kind === "vencida"
            ? "El plazo de respuesta ya se cumplio. Aun puedes responderla; quedara marcada como fuera de tiempo."
            : `Quedan menos de ${Math.ceil(n.remaining)} horas habiles para responder.`,
        link: `/comprador/solicitudes/${n.requestId}`,
        ref_id: n.requestId,
      });
      // 23505 = ya se aviso antes (indice unico de deduplicacion).
      if (!error) created++;
      else if (error.code !== "23505") console.error("cron avisos:", error.message);
    }
  }
  return NextResponse.json({ revisadas: reqs?.length ?? 0, avisos: notices.length, creadas: created });
}
