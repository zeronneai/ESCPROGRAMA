import "server-only";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/guards";

/** Jefa de ventas (o comprador, solo lectura) para las paginas de /ventas. */
export async function requireSalesViewer(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.rol !== "jefe_ventas" && u.rol !== "comprador") redirect("/");
  return u;
}
