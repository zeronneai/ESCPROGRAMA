import type { Rol } from "@/lib/auth/route-guard";

export const ROL_LABEL: Record<Rol, string> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  jefe_ventas: "Jefa de ventas",
  gerente: "Gerente",
  coordinador_iso: "Coordinador ISO",
  marketplaces: "Marketplaces",
  almacen: "Almacén",
  supervisor_almacen: "Supervisor de almacén",
  supervisor_finanzas: "Supervisor de finanzas",
  ceo: "CEO",
};

/** Almacen: el auxiliar y el supervisor califican lo recibido de los proveedores. */
export const ALMACEN_ROLES: Rol[] = ["almacen", "supervisor_almacen"];

/** Jefes de departamento: crean minutas. */
export const MINUTA_CREATORS: Rol[] = ["jefe_ventas", "gerente", "comprador", "supervisor_almacen", "supervisor_finanzas", "ceo"];

/** Puestos que leen ventas, clientes y bitacora de todos (sin editar). */
export const SALES_READERS: Rol[] = ["jefe_ventas", "gerente", "coordinador_iso", "comprador", "ceo"];
