import { NextResponse } from "next/server";
import { CATALOGO } from "@/lib/marca";

/** Liga corta para mandar a clientes: /catalogo abre el PDF vigente. */
export function GET(req: Request) {
  return NextResponse.redirect(new URL(CATALOGO.archivo, req.url));
}
