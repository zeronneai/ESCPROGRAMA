import { redirect } from "next/navigation";

/** El QR de cada etiqueta apunta aqui: abre la ficha de la etiqueta (pide iniciar sesion). */
export default async function E({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  redirect(`/almacen/etiqueta/${encodeURIComponent(codigo.toUpperCase())}`);
}
