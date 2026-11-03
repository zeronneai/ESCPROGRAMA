import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { EnviarMinuta, FirmarMinuta } from "@/components/minutas/minuta-acciones";
import { MinutaDoc } from "@/components/minutas/minuta-doc";
import { MinutaForm, type MinutaUsuario } from "@/components/minutas/minuta-form";
import { Chip } from "@/components/ops-ui";
import { Alert, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";
import { MINUTA_COLS, minutaEstado, type MinutaFirma, type MinutaRow } from "@/lib/minutas";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function MinutaDetalle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ enviada?: string; editar?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: m }, { data: fs }] = await Promise.all([
    supabase.from("minutas").select(MINUTA_COLS).eq("id", id).maybeSingle(),
    supabase.from("minuta_firmas").select("minuta_id, user_id, nombre, puesto, correo, firmada_at").eq("minuta_id", id).order("created_at"),
  ]);
  if (!m) notFound();
  const minuta = m as unknown as MinutaRow;
  const firmas = (fs ?? []) as MinutaFirma[];
  const mine = firmas.find((f) => f.user_id === u.id);
  const autor = minuta.created_by === u.id;
  const st = minutaEstado(minuta, firmas);

  if (autor && minuta.estado === "borrador" && sp.editar !== "0") {
    const cfg = await getBusinessSettings(supabase);
    const { data: us } = await supabase.rpc("minuta_usuarios");
    return (
      <div className="space-y-4">
        <Link href="/minutas" className="text-sm text-slate-500 hover:text-slate-800">← Minutas</Link>
        <PageHeader title={`Minuta ${minuta.numero}`} subtitle="Borrador: puedes seguir editándola. Al enviarla a firmas ya no se puede cambiar." actions={<Link href={`/minutas/${id}?editar=0`} className="text-sm text-brand-700 underline">Ver como quedará</Link>} />
        <MinutaForm minuta={minuta} firmantes={firmas.map((f) => f.user_id)} usuarios={(us ?? []) as MinutaUsuario[]} yo={u.id} today={DateTime.now().setZone(cfg.timezone).toISODate()!} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/minutas" className="text-sm text-slate-500 hover:text-slate-800">← Minutas</Link>
      <PageHeader
        title={minuta.tema}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{minuta.numero}</span><Chip cls={st.cls}>{st.label}</Chip></span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {autor && minuta.estado === "borrador" && <Link href={`/minutas/${id}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Editar</Link>}
            <a href={`/imprimir/minuta/${id}`} target="_blank" rel="noreferrer" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Imprimir</a>
          </div>
        }
      />
      {sp.enviada && <Alert tone="success">Enviada a firmas. Cada persona recibió un aviso.</Alert>}
      {mine && minuta.estado === "enviada" && !mine.firmada_at && (
        <Card className="flex flex-col gap-3 border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-900">Revisa la minuta y fírmala de enterado.</p>
          <FirmarMinuta id={id} />
        </Card>
      )}
      {autor && minuta.estado === "borrador" && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-700">Es un borrador. Cuando esté lista, envíala para que la firmen.</p>
          <EnviarMinuta id={id} />
        </Card>
      )}
      <Card className="overflow-x-auto p-4 sm:p-6">
        <MinutaDoc m={minuta} firmas={firmas} />
      </Card>
    </div>
  );
}
