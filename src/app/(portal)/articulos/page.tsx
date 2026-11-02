import { Chip } from "@/components/ops-ui";
import { Card, EmptyState, FilterChip, PageHeader, Pagination } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { ESTATUS_ARTICULO, normalizar, type Articulo } from "@/lib/articulos";
import { createClient } from "@/lib/supabase/server";

const PER = 50;

export default async function Articulos({ searchParams }: { searchParams: Promise<{ q?: string; familia?: string; ver?: string; p?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const ver = sp.ver === "todos" ? "todos" : sp.ver === "no" ? "no" : "vendibles";
  const page = Math.max(1, Number(sp.p) || 1);
  const supabase = await createClient();
  const words = normalizar(sp.q ?? "").replace(/[%_,()]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
  let query = supabase.from("articulos").select("id, clave, nombre, familia, estatus, vendible, clave_sat, ultima_compra", { count: "exact" });
  for (const w of words) query = query.ilike("busqueda", `%${w}%`);
  if (sp.familia) query = query.eq("familia", sp.familia);
  if (ver === "vendibles") query = query.eq("vendible", true);
  if (ver === "no") query = query.eq("vendible", false);
  const [{ data, count }, { data: fams }] = await Promise.all([
    query.order("nombre").range((page - 1) * PER, page * PER - 1),
    supabase.from("articulos").select("familia").eq("vendible", true).limit(2000),
  ]);
  const rows = (data ?? []) as (Articulo & { clave_sat: string | null; ultima_compra: string | null })[];
  const familias = Object.entries((fams ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.familia]: (a[r.familia] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14);
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, familia: sp.familia, ver: ver === "vendibles" ? undefined : ver, ...o })) if (v) p.set(k, v);
    return `/articulos${p.size ? `?${p}` : ""}`;
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Catálogo de artículos" subtitle="Lo que ESC vende. En la bitácora solo se pueden elegir los activos (y los que ya no se compran pero tienen existencia)." />
      <form method="get" className="flex gap-2">
        {sp.familia && <input type="hidden" name="familia" value={sp.familia} />}
        {ver !== "vendibles" && <input type="hidden" name="ver" value={ver} />}
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por nombre o clave: guante nitrilo M, bata ESD, ESC-A704" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm" />
        <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Buscar</button>
      </form>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterChip href={href({ ver: undefined, p: undefined })} active={ver === "vendibles"}>Se pueden vender</FilterChip>
        <FilterChip href={href({ ver: "no", p: undefined })} active={ver === "no"}>Suspendidos y bajas</FilterChip>
        <FilterChip href={href({ ver: "todos", p: undefined })} active={ver === "todos"}>Todos</FilterChip>
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 text-xs sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterChip href={href({ familia: undefined, p: undefined })} active={!sp.familia}>Todas las familias</FilterChip>
        {familias.map(([f, n]) => (
          <FilterChip key={f} href={href({ familia: f, p: undefined })} active={sp.familia === f}>{f} {n}</FilterChip>
        ))}
      </div>
      <p className="text-xs text-slate-500">{count ?? 0} artículo(s)</p>
      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyState title="Sin artículos con esos filtros" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{a.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {a.clave} · {a.familia}{a.clave_sat && ` · SAT ${a.clave_sat}`}
                    {a.ultima_compra && ` · Última compra ${new Date(`${a.ultima_compra}T12:00:00`).toLocaleDateString("es-MX", { month: "short", year: "numeric" })}`}
                  </p>
                </div>
                <Chip cls={ESTATUS_ARTICULO[a.estatus].chip}>{ESTATUS_ARTICULO[a.estatus].label}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} pages={Math.max(1, Math.ceil((count ?? 0) / PER))} hrefFor={(p) => href({ p: p > 1 ? String(p) : undefined })} />
    </div>
  );
}
