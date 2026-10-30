import { redirect } from "next/navigation";

/** Los avisos viejos apuntaban aqui; los leads se copiaron a la Bitacora (Prospeccion). */
export default function Lead() {
  redirect("/vendedor/bitacora?tab=prospeccion");
}
