import Link from "next/link";
import { notFound } from "next/navigation";
import { EvalLado } from "@/components/eval/eval-proveedor-form";
import { Chip, Dl } from "@/components/ops-ui";
import { Card, PageHeader } from "@/components/ui";
import { requireRoles } from "@/lib/auth/sales";
import { clasificacionProveedor, type Pregunta } from "@/lib/evaluaciones";
import { createClient } from "@/lib/supabase/server";

export default async function EvalProveedor({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRoles(["comprador", "almacen", "supervisor_almacen", "gerente", "ceo", "coordinador_iso"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: e }, { data: qs }] = await Promise.all([
    supabase.from("eval_proveedor").select("*, suppliers(nombre, razon_social, giro, contacto_nombre, telefono, correo, tipo, pais), eval_periodos(nombre, estado)").eq("id", id).maybeSingle(),
    supabase.from("eval_preguntas").select("id, tipo, responsable, orden, texto, ayuda").eq("tipo", "proveedor").eq("activo", true).order("orden"),
  ]);
  if (!e) notFound();
  const s = e.suppliers as { nombre: string; razon_social: string | null; giro: string | null; contacto_nombre: string | null; telefono: string | null; correo: string | null; tipo: string; pais: string | null } | null;
  const per = e.eval_periodos as { nombre: string; estado: string } | null;
  const activa = per?.estado === "activo";
  const ids = [e.comprador_por, e.almacen_por].filter(Boolean) as string[];
  const { data: ps } = ids.length ? await supabase.from("profiles").select("id, nombre").in("id", ids) : { data: [] };
  const name = (x: string | null) => (ps ?? []).find((p) => p.id === x)?.nombre ?? null;
  const preguntas = (qs ?? []) as Pregunta[];
  const cl = e.comprador_at && e.almacen_at ? clasificacionProveedor(e.puntaje) : null;
  return (
    <div className="space-y-4">
      <Link href="/evaluaciones/proveedores" className="text-sm text-slate-500 hover:text-slate-800">← Evaluación de proveedores</Link>
      <PageHeader title={s?.nombre ?? "Proveedor"} subtitle={`${per?.nombre ?? ""}${activa ? " · activa" : " · cerrada"}`} />
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <Dl items={[["Qué surte", s?.giro], ["Contacto", [s?.contacto_nombre, s?.telefono, s?.correo].filter(Boolean).join(" · ")], ["Origen", s?.tipo === "extranjero" ? s?.pais || "Extranjero" : "Nacional"]]} />
        <div className="shrink-0 text-right">
          {cl ? <Chip cls={cl.cls}>{e.puntaje}% · {cl.label}</Chip> : <span className="text-sm text-slate-500">{e.puntaje !== null ? `${e.puntaje}% parcial` : "Sin calificar"}</span>}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <EvalLado
          evalId={e.id}
          titulo="Comprador"
          preguntas={preguntas.filter((p) => p.responsable === "comprador")}
          resp={e.comprador_resp ?? {}}
          comentario={e.comprador_comentario}
          quien={name(e.comprador_por)}
          cuando={e.comprador_at}
          editable={activa && u.rol === "comprador"}
        />
        <EvalLado
          evalId={e.id}
          titulo="Almacén"
          preguntas={preguntas.filter((p) => p.responsable === "almacen")}
          resp={e.almacen_resp ?? {}}
          comentario={e.almacen_comentario}
          quien={name(e.almacen_por)}
          cuando={e.almacen_at}
          editable={activa && (u.rol === "almacen" || u.rol === "supervisor_almacen")}
        />
      </div>
    </div>
  );
}
