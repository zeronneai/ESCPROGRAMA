import { CatalogoPopup } from "@/components/catalogo-popup";
import { CATALOGO, CATALOGO_VISIBLE } from "@/lib/marca";
import { createClient } from "@/lib/supabase/server";

/**
 * Aviso del catalogo nuevo: sale a cada usuario hasta que le da "Listo".
 * Si la tabla todavia no existe (falta la 0053) no se muestra nada.
 */
export async function CatalogoAviso({ userId, rol }: { userId: string; rol: string }) {
  if (!CATALOGO_VISIBLE) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("catalogo_vistos").select("version").eq("user_id", userId).eq("version", CATALOGO.version).maybeSingle();
  if (error) return null;
  return <CatalogoPopup abierto={!data} vende={["vendedor", "jefe_ventas", "marketplaces"].includes(rol)} comprador={rol === "comprador"} />;
}
