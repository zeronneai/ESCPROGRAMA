import Link from "next/link";
import { GuiaIso } from "@/components/iso/guia-iso";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guards";

export const metadata = { title: "Norma ISO 9001:2015" };

export default async function NormaIsoPage() {
  await requireUser();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Norma ISO 9001:2015"
        subtitle="Qué pide cada cláusula, en palabras sencillas, y dónde está la evidencia de ESC en el portal."
      />
      <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
        Esta es una guía de trabajo, no el texto oficial: la norma tiene derechos de autor. El documento oficial se compra a ISO o, en México,
        como NMX-CC-9001-IMNC-2015 (su equivalente nacional). Para la auditoría, el auditor revisa contra el texto oficial.
        Si ESC tiene su copia adquirida, súbanla en <Link href="/documentos" className="font-semibold underline">Documentos</Link> como documento externo para consultarla completa.
      </p>
      <GuiaIso />
    </div>
  );
}
