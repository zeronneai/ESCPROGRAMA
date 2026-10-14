import Link from "next/link";
import { LeadForm } from "@/components/lead-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";

export default async function NuevoLead() {
  await requireUser();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/vendedor/leads" className="text-sm text-slate-500 hover:text-slate-800">
        ← Leads
      </Link>
      <PageHeader title="Nuevo lead" subtitle="Registra al prospecto. Con la empresa y un dato de contacto es suficiente para empezar." />
      <Card className="p-4 sm:p-6">
        <LeadForm />
      </Card>
    </div>
  );
}
