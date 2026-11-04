import "server-only";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/guards";
import type { Rol } from "@/lib/auth/route-guard";

/** Exige uno de los puestos indicados; si no, manda a su inicio. */
export async function requireRoles(roles: Rol[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.includes(u.rol)) redirect("/");
  return u;
}

/** Jefa de ventas, gerente, coordinador ISO o comprador para las paginas de /ventas. */
export async function requireSalesViewer(): Promise<SessionUser> {
  return requireRoles(["jefe_ventas", "gerente", "coordinador_iso", "comprador", "ceo"]);
}
