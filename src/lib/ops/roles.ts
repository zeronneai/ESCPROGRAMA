import type { Rol } from "@/lib/auth/route-guard";

export const ROL_LABEL: Record<Rol, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  jefe_ventas: "Jefa de ventas",
  gerente: "Gerente",
  coordinador_iso: "Coordinador ISO",
  marketplaces: "Marketplaces",
  almacen: "Almacén",
};

/** Puestos que leen ventas, clientes y bitacora de todos (sin editar). */
export const SALES_READERS: Rol[] = ["jefe_ventas", "gerente", "coordinador_iso", "comprador"];
