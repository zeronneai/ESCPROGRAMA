export interface Articulo {
  id: string;
  clave: string;
  nombre: string;
  familia: string;
  estatus: "activo" | "suspension_compras" | "suspension_compras_ventas" | "baja";
  vendible: boolean;
}
export interface BitacoraArticulo {
  id: string | null;
  articulo_id: string;
  clave: string;
  nombre: string;
  cantidad: number | null;
}
export const ESTATUS_ARTICULO: Record<Articulo["estatus"], { label: string; chip: string }> = {
  activo: { label: "Activo", chip: "bg-green-100 text-green-800" },
  suspension_compras: { label: "Sin compras (hay existencia)", chip: "bg-amber-100 text-amber-900" },
  suspension_compras_ventas: { label: "Suspendido", chip: "bg-slate-200 text-slate-700" },
  baja: { label: "Baja", chip: "bg-red-100 text-red-800" },
};

/** Texto de busqueda: minusculas y sin acentos (igual que la columna busqueda de la base). */
export const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
