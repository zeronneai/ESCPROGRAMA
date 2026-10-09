import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { auditReport, partidasReport } from "@/lib/export/reports";
import { toCsv, toXlsx } from "@/lib/export/tabular";
import { getBusinessSettings } from "@/lib/quotes/server";
import { defaultRange } from "@/lib/stats/queries";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const schema = z.object({
  tipo: z.enum(["partidas", "auditoria"]),
  formato: z.enum(["xlsx", "csv"]).default("xlsx"),
  desde: date,
  hasta: date,
  vendedor: z.string().uuid().optional(),
  cliente: z.string().uuid().optional(),
  moneda: z.enum(["MXN", "USD"]).optional(),
});

/** Solo compradores (el middleware ya lo exige para /api/admin; aqui se verifica de nuevo). */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.rol !== "comprador" || user.must_change_password) {
    return NextResponse.json({ error: "sin_permiso" }, { status: 403 });
  }
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries().filter(([, v]) => v !== "")));
  if (!parsed.success) return NextResponse.json({ error: "parametros_invalidos" }, { status: 400 });
  const p = parsed.data;

  const supabase = await createClient();
  const cfg = await getBusinessSettings(supabase);
  const range = { ...defaultRange(cfg.timezone), ...(p.desde ? { desde: p.desde } : {}), ...(p.hasta ? { hasta: p.hasta } : {}) };
  const table =
    p.tipo === "partidas"
      ? await partidasReport(supabase, { ...range, vendedor: p.vendedor, cliente: p.cliente, moneda: p.moneda }, cfg)
      : await auditReport(supabase, range, cfg.timezone);

  const base = `${p.tipo}_${range.desde}_a_${range.hasta}`;
  if (p.formato === "csv") {
    return new NextResponse(toCsv(table), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` },
    });
  }
  return new NextResponse(new Uint8Array(await toXlsx(table)), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
