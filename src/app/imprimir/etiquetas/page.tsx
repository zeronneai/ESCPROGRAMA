import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import Link from "next/link";
import { AutoPrint } from "@/components/almacen/auto-print";
import { PrintButton } from "@/components/minutas/minuta-acciones";
import { requireUser } from "@/lib/auth/guards";
import { qrEtiqueta } from "@/lib/almacen";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Etiquetas | ESC" };
export const dynamic = "force-dynamic";

type Et = { codigo: string; recibida: string; articulos: { clave: string; nombre: string } | null; recepciones: { folio: string } | null };
const FORMATOS = {
  carta: { label: "Hoja carta (21 por hoja, para recortar)" },
  "50x25": { label: "Etiquetadora 50 x 25 mm" },
  "100x50": { label: "Etiquetadora 100 x 50 mm" },
} as const;
type Formato = keyof typeof FORMATOS;

/** Etiquetas con QR para imprimir (sin fecha ni folio de recepcion: la caja llega al cliente; esos datos se ven al escanear dentro del portal): hoja carta para pruebas o etiquetadora termica (una etiqueta por pagina). */
export default async function ImprimirEtiquetas({ searchParams }: { searchParams: Promise<{ recepcion?: string; linea?: string; codigos?: string; formato?: string; auto?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const formato: Formato = sp.formato && sp.formato in FORMATOS ? (sp.formato as Formato) : "carta";
  const supabase = await createClient();
  let q = supabase.from("etiquetas").select("codigo, recibida, articulos(clave, nombre), recepciones(folio)").order("codigo").limit(3000);
  const uuid = /^[0-9a-f-]{36}$/i;
  if (sp.codigos) q = q.in("codigo", sp.codigos.toUpperCase().split(",").filter((c) => /^E-\d{4,}$/.test(c)).slice(0, 500));
  else if (sp.linea && uuid.test(sp.linea)) q = q.eq("linea_id", sp.linea);
  else if (sp.recepcion && uuid.test(sp.recepcion)) q = q.eq("recepcion_id", sp.recepcion);
  else q = q.eq("codigo", "__ninguna__");
  const { data } = await q;
  const ets = (data ?? []) as unknown as Et[];
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const qrs = await Promise.all(ets.map((e) => QRCode.toString(qrEtiqueta(origin, e.codigo), { type: "svg", margin: 0, errorCorrectionLevel: "M" })));
  const base = Object.entries(sp).filter(([k]) => k !== "formato" && k !== "auto").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

  const css =
    formato === "carta"
      ? `@page { size: letter; margin: 8mm; }
         .hoja { display: grid; grid-template-columns: repeat(3, 64mm); grid-auto-rows: 35mm; gap: 2mm; }
         .et { border: 1px dashed #94a3b8; padding: 2mm; display: flex; gap: 2.5mm; align-items: center; overflow: hidden; break-inside: avoid; }
         .qr { width: 27mm; height: 27mm; flex: none; } .cod { font-size: 11pt; } .clave { font-size: 8pt; } .nom { font-size: 6.5pt; -webkit-line-clamp: 3; } .meta { font-size: 6.5pt; }`
      : formato === "50x25"
        ? `@page { size: 50mm 25mm; margin: 0; }
           .et { width: 50mm; height: 25mm; padding: 1.5mm; display: flex; gap: 1.5mm; align-items: center; overflow: hidden; break-after: page; }
           .qr { width: 21mm; height: 21mm; flex: none; } .cod { font-size: 9pt; } .clave { font-size: 6.5pt; } .nom { font-size: 5pt; -webkit-line-clamp: 2; } .meta { font-size: 5pt; }`
        : `@page { size: 100mm 50mm; margin: 0; }
           .et { width: 100mm; height: 50mm; padding: 3mm; display: flex; gap: 3.5mm; align-items: center; overflow: hidden; break-after: page; }
           .qr { width: 42mm; height: 42mm; flex: none; } .cod { font-size: 16pt; } .clave { font-size: 11pt; } .nom { font-size: 8.5pt; -webkit-line-clamp: 3; } .meta { font-size: 8pt; }`;

  return (
    <main className="bg-white text-black">
      <style>{`${css}
        .et { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; }
        .qr svg { width: 100%; height: 100%; display: block; }
        .txt { min-width: 0; display: flex; flex-direction: column; gap: 0.6mm; }
        .cod { font-weight: 700; font-family: "Courier New", monospace; letter-spacing: 0.2px; }
        .clave { font-weight: 700; }
        .nom { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.15; }
        @media print { .no-print { display: none !important; } body { background: #fff; } main { padding: 0 !important; } }
        @media screen { main { padding: 16px; } .hoja-screen { display: flex; flex-wrap: wrap; gap: 8px; } .et { border: 1px dashed #94a3b8; } }`}</style>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        {sp.recepcion && <Link href={`/almacen/recepciones/${sp.recepcion}`} className="rounded-md border border-slate-300 bg-white px-3 py-1 text-slate-700">← Volver a la recepción</Link>}
        <span className="font-semibold">{ets.length} etiqueta(s)</span>
        <span className="text-slate-600">Formato:</span>
        {(Object.keys(FORMATOS) as Formato[]).map((f) => (
          <a key={f} href={`?${base}&formato=${f}`} className={`rounded-full px-3 py-1 ${f === formato ? "bg-slate-900 text-white" : "border border-slate-300 bg-white"}`}>{FORMATOS[f].label}</a>
        ))}
        <span className="ml-auto"><PrintButton /></span>
        <p className="w-full text-xs text-slate-500">
          {formato === "carta"
            ? "Imprime en tamaño carta al 100% (sin \"ajustar a la página\"), recorta por la línea punteada y pega cada etiqueta en su caja."
            : "En la ventana de impresión elige la etiquetadora y el tamaño de papel de la etiqueta, márgenes: ninguno, escala: 100%."}
        </p>
      </div>
      {ets.length > 0 && <AutoPrint />}
      <div className={formato === "carta" ? "hoja" : "hoja-screen"}>
        {ets.map((e, i) => (
          <div key={e.codigo} className="et">
            <div className="qr" dangerouslySetInnerHTML={{ __html: qrs[i] }} />
            <div className="txt">
              <span className="cod">{e.codigo}</span>
              <span className="clave">{e.articulos?.clave}</span>
              <span className="nom">{e.articulos?.nombre}</span>
            </div>
          </div>
        ))}
      </div>
      {ets.length === 0 && <p className="text-sm text-slate-600">No hay etiquetas para imprimir.</p>}
    </main>
  );
}
