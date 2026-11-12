import { Alert, Card, EmptyState, FilterChip, PageHeader } from "@/components/ui";
import { RevisarComentario } from "@/components/catalogo-revisar";
import { requireRoles } from "@/lib/auth/sales";
import { CATALOGO } from "@/lib/marca";
import { ROL_LABEL } from "@/lib/ops/roles";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/auth/route-guard";

type Comentario = { id: string; texto: string; autor_nombre: string | null; autor_rol: string | null; revisado_at: string | null; created_at: string };

const fecha = (s: string) => new Date(s).toLocaleString("es-MX", { timeZone: "America/Chihuahua", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function ComentariosCatalogo({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await requireRoles(["comprador"]);
  const { ver = "nuevos" } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("catalogo_comentarios").select("id, texto, autor_nombre, autor_rol, revisado_at, created_at").order("created_at", { ascending: false }).limit(500);
  const todos = (data ?? []) as Comentario[];
  const nuevos = todos.filter((c) => !c.revisado_at);
  const filas = ver === "todos" ? todos : nuevos;
  return (
    <div className="space-y-4">
      <PageHeader title="Comentarios del catálogo" subtitle={<>Sugerencias y correcciones del equipo sobre el <a href={CATALOGO.archivo} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">{CATALOGO.nombre}</a>.</>} />
      {error && <Alert tone="error">Primero corre la actualización 0053 en Supabase.</Alert>}
      <div className="flex flex-wrap gap-2">
        <FilterChip href="/comprador/catalogo?ver=nuevos" active={ver !== "todos"}>Sin revisar ({nuevos.length})</FilterChip>
        <FilterChip href="/comprador/catalogo?ver=todos" active={ver === "todos"}>Todos ({todos.length})</FilterChip>
      </div>
      {!filas.length ? (
        <EmptyState title={ver === "todos" ? "Todavía no hay comentarios" : "No hay comentarios por revisar"}>Cuando alguien deje una sugerencia del catálogo, te llega aviso y aparece aquí.</EmptyState>
      ) : (
        <div className="space-y-3">
          {filas.map((c) => (
            <Card key={c.id} className={`space-y-2 p-4 ${c.revisado_at ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-semibold text-slate-900">{c.autor_nombre ?? "Alguien del equipo"}</span>
                  {c.autor_rol && <span className="text-slate-500"> · {ROL_LABEL[c.autor_rol as Rol] ?? c.autor_rol}</span>}
                  <span className="text-slate-400"> · {fecha(c.created_at)}</span>
                </p>
                <RevisarComentario id={c.id} revisado={!!c.revisado_at} />
              </div>
              <p className="whitespace-pre-line text-sm text-slate-800">{c.texto}</p>
              {c.revisado_at && <p className="text-xs font-medium text-green-700">Revisado el {fecha(c.revisado_at)}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
