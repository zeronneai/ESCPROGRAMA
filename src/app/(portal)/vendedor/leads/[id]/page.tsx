import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadDetail } from "./lead-detail";
import { requireUser } from "@/lib/auth/guards";
import type { LeadActivityRow, LeadRow } from "@/lib/leads/types";
import { getBusinessSettings } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: lead }, { data: acts }, cfg] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(500),
    getBusinessSettings(supabase),
  ]);
  if (!lead) notFound();
  const l = lead as LeadRow;
  const { data: customer } = l.customer_id
    ? await supabase.from("customers").select("id, nombre, tipo").eq("id", l.customer_id).maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/vendedor/leads" className="text-sm text-slate-500 hover:text-slate-800">
        ← Leads
      </Link>
      <LeadDetail
        lead={l}
        activities={(acts ?? []) as LeadActivityRow[]}
        isMine={l.vendedor_id === user.id}
        customer={customer as { id: string; nombre: string; tipo: string } | null}
        timezone={cfg.timezone}
      />
    </div>
  );
}
