import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ejecutar, HERRAMIENTAS, MODELO, sistema, type Propuesta } from "@/lib/asistente-compras";
import { getSessionUser } from "@/lib/auth/guards";
import { cargarPlaneacion } from "@/lib/planeacion-server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const cuerpo = z.object({
  mensajes: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20000) })).min(1).max(60),
});

const PASOS: Record<string, string> = {
  resumen_general: "Revisando el panorama de proveedores",
  articulos_proveedor: "Revisando artículos del proveedor",
  buscar_articulo: "Buscando el artículo",
  historial_articulo: "Viendo el historial de venta",
  tendencia_proveedor: "Viendo cómo se mueve la venta",
  ocs: "Revisando las órdenes de compra",
  detalle_oc: "Abriendo la OC",
  pedidos_vendedores: "Revisando pedidos de vendedores",
  guardar_reglas: "Guardando tus reglas",
  proponer_ocs: "Armando la propuesta de OCs",
};

/**
 * Chat del asistente de compras (solo comprador). Responde en NDJSON:
 * {t:"paso"} mientras consulta, {t:"propuesta"} si propone OCs, {t:"texto"} con la respuesta y {t:"fin"}.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.must_change_password) return NextResponse.json({ error: "no_autenticado" }, { status: 401 });
  if (user.rol !== "comprador") return NextResponse.json({ error: "sin_permiso" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Falta la clave ANTHROPIC_API_KEY en Vercel (Settings > Environment Variables)." }, { status: 503 });
  const p = cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });

  const supabase = await createClient();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const manda = (o: unknown) => ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      let entrada = 0;
      let salida = 0;
      try {
        manda({ t: "paso", texto: "Cargando la planeación" });
        const [datos, { data: reg }] = await Promise.all([cargarPlaneacion(supabase), supabase.from("plan_asistente").select("reglas").eq("id", 1).maybeSingle()]);
        const ctx = { datos, supabase, propuesta: null as Propuesta | null, reglas: (reg?.reglas as string | undefined) ?? "" };
        const cliente = new Anthropic();
        const mensajes: Anthropic.MessageParam[] = p.data.mensajes.map((m) => ({ role: m.role, content: m.content }));
        const herramientas = HERRAMIENTAS.map((h, i) => (i === HERRAMIENTAS.length - 1 ? { ...h, cache_control: { type: "ephemeral" as const } } : h));
        for (let vuelta = 0; vuelta < 14; vuelta++) {
          const r = await cliente.messages.create({
            model: MODELO,
            max_tokens: 8000,
            system: [{ type: "text", text: sistema(datos, ctx.reglas), cache_control: { type: "ephemeral" } }],
            tools: herramientas,
            messages: mensajes,
          });
          entrada += (r.usage.input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0) + (r.usage.cache_read_input_tokens ?? 0);
          salida += r.usage.output_tokens ?? 0;
          mensajes.push({ role: "assistant", content: r.content });
          const usos = r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (r.stop_reason !== "tool_use" || !usos.length) {
            const texto = r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
            if (ctx.propuesta?.ocs.length) manda({ t: "propuesta", propuesta: ctx.propuesta });
            manda({ t: "texto", texto: texto || (r.stop_reason === "max_tokens" ? "(La respuesta quedó cortada; pídeme que continúe.)" : "Listo.") });
            break;
          }
          const resultados: Anthropic.ToolResultBlockParam[] = [];
          for (const u of usos) {
            manda({ t: "paso", texto: PASOS[u.name] ?? u.name });
            let out: unknown;
            try {
              out = await ejecutar(u.name, (u.input ?? {}) as Record<string, unknown>, ctx);
            } catch (e) {
              out = { error: (e as Error).message };
            }
            if (u.name === "guardar_reglas" && !(out as { error?: string }).error) manda({ t: "reglas", reglas: ctx.reglas });
            resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), ...((out as { error?: string })?.error ? { is_error: true } : {}) });
          }
          mensajes.push({ role: "user", content: resultados });
          if (vuelta === 13) manda({ t: "texto", texto: "Me tomó demasiadas consultas. Pregúntame algo más concreto." });
        }
      } catch (e) {
        const msg = e instanceof Anthropic.APIError ? (e.status === 401 ? "La clave ANTHROPIC_API_KEY no es válida." : e.status === 429 ? "Claude está saturado o se acabó el saldo de la cuenta; intenta en un momento." : `Claude respondió con error (${e.status}).`) : (e as Error).message;
        manda({ t: "error", error: msg });
      } finally {
        if (entrada || salida) await supabase.from("plan_asistente_uso").insert({ modelo: MODELO, entrada, salida });
        manda({ t: "fin", uso: { entrada, salida } });
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
