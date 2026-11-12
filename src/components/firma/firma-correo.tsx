import { headers } from "next/headers";
import { FirmaModal } from "@/components/firma/firma-modal";
import type { SessionUser } from "@/lib/auth/guards";
import { FIRMA_AUTO_ROLES, LEYENDA_QUEJAS, PUESTO_FIRMA, firmaSchema, type Firma } from "@/lib/firma";
import { QUEJAS_LINK_RUTA } from "@/lib/ops/calidad";
import { getCompanyProfile } from "@/lib/quotes/server";
import { createClient } from "@/lib/supabase/server";

/** Firma de correo (servidor): arma los datos por omision y decide si la ventana sale sola. */
export async function FirmaCorreo({ user }: { user: Pick<SessionUser, "id" | "nombre" | "email" | "rol"> }) {
  const supabase = await createClient();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [{ data: p, error }, empresa] = await Promise.all([
    supabase.from("profiles").select("firma, firma_at, firma_pospuesta_at").eq("id", user.id).maybeSingle(),
    getCompanyProfile(supabase).catch(() => null),
  ]);
  // Sin la actualizacion 0046 todavia: la firma se puede hacer, pero no se guarda ni sale sola.
  const listo = !error;
  const base: Firma = {
    nombre: user.nombre,
    puesto: PUESTO_FIRMA[user.rol] ?? "",
    correo: user.email ?? "",
    telefono: empresa?.telefono ?? "",
    telefono2: "",
    direccion: empresa?.direccion ?? "",
    web: empresa?.web ?? "",
    leyenda: LEYENDA_QUEJAS,
    link: `${origin}${QUEJAS_LINK_RUTA}`,
  };
  const guardada = listo && p?.firma ? firmaSchema.safeParse({ ...base, ...(p.firma as object) }) : null;
  const pospuesta = p?.firma_pospuesta_at && Date.now() - Date.parse(p.firma_pospuesta_at) < 86_400_000;
  const auto = listo && FIRMA_AUTO_ROLES.includes(user.rol) && !p?.firma_at && !pospuesta;
  return <FirmaModal inicial={guardada?.success ? guardada.data : base} auto={auto} guardar={listo} />;
}
