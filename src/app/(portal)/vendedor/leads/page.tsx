import { redirect } from "next/navigation";

/** Leads ahora vive en la Bitacora (pestaña Prospeccion). */
export default function Leads() {
  redirect("/vendedor/bitacora?tab=prospeccion");
}
